#!/usr/bin/env python3
"""
Base Crawler - Common patterns for web crawling
Provides foundational functionality for building specialized crawlers.

This module demonstrates production-ready web crawling techniques:
- Session pooling with connection reuse
- Rate limiting and politeness
- HTML cleaning and content extraction
- URL normalization and filtering
- Markdown conversion with metadata

Author: Scott Allen
"""

import json
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

import html2text
import requests
from bs4 import BeautifulSoup


class BaseCrawler(ABC):
    """
    Abstract base class for web crawlers.

    Provides common functionality:
    - HTTP session management with connection pooling
    - URL filtering and normalization
    - Content cleaning and markdown conversion
    - Rate limiting
    - Progress tracking and summary generation

    Subclasses must implement:
    - get_seed_urls(): Return initial URLs to crawl
    - should_skip_url(): Custom URL filtering logic
    """

    def __init__(
        self,
        base_url: str,
        output_dir: Path,
        max_pages: int = 500,
        max_depth: int = 5,
        crawl_delay: float = 1.0,
        user_agent: str = "DocumentCrawler/1.0"
    ):
        """
        Initialize the crawler.

        Args:
            base_url: The root URL to crawl
            output_dir: Directory to save crawled content
            max_pages: Maximum number of pages to crawl
            max_depth: Maximum link depth from seed URLs
            crawl_delay: Seconds to wait between requests (be polite!)
            user_agent: User-Agent header for requests
        """
        self.base_url = base_url
        self.output_dir = Path(output_dir)
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.crawl_delay = crawl_delay

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Tracking state
        self.visited: Set[str] = set()
        self.queue: List[Tuple[str, int, int]] = []  # (url, depth, priority)
        self.pages_crawled = 0
        self.saved_files: List[str] = []
        self.url_to_file: Dict[str, str] = {}
        self.errors: List[Dict] = []

        # Initialize HTTP session with connection pooling
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': user_agent})

        # Enable connection pooling for efficiency
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=20,
            max_retries=3,
            pool_block=False
        )
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

        # Initialize HTML to Markdown converter
        self.h2t = html2text.HTML2Text()
        self.h2t.ignore_links = False
        self.h2t.ignore_images = True
        self.h2t.ignore_emphasis = False
        self.h2t.body_width = 0  # Don't wrap lines
        self.h2t.skip_internal_links = False

        # Common patterns to skip (override in subclass to customize)
        self.default_skip_patterns = [
            '/wp-admin/',
            '/wp-json/',
            '/feed/',
            '/wp-login',
            '/xmlrpc.php',
            '?replytocom=',
            '/attachment/',
            '/trackback/',
            '#',  # Anchor-only links
        ]

        # File extensions to skip
        self.skip_extensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx',
            '.ppt', '.pptx', '.zip', '.tar', '.gz',
            '.jpg', '.jpeg', '.png', '.gif', '.svg',
            '.ico', '.css', '.js', '.woff', '.ttf'
        ]

        print(f"Initialized {self.__class__.__name__}")
        print(f"  Base URL: {base_url}")
        print(f"  Output: {output_dir}")
        print(f"  Max pages: {max_pages}")
        print(f"  Max depth: {max_depth}")
        print(f"  Delay: {crawl_delay}s")
        print("-" * 60)

    @abstractmethod
    def get_seed_urls(self) -> List[str]:
        """
        Return the initial URLs to start crawling from.
        Override this to implement sitemap parsing, etc.
        """
        pass

    def should_skip_url(self, url: str) -> bool:
        """
        Check if URL should be skipped.
        Override to add custom filtering logic.

        Args:
            url: The URL to check

        Returns:
            True if URL should be skipped
        """
        # Must be same domain
        if not url.startswith(self.base_url):
            return True

        # Check default skip patterns
        for pattern in self.default_skip_patterns:
            if pattern in url:
                return True

        # Check file extensions
        url_lower = url.lower()
        for ext in self.skip_extensions:
            if url_lower.endswith(ext):
                return True

        return False

    def normalize_url(self, url: str) -> str:
        """
        Normalize URL for consistent comparison.

        Args:
            url: The URL to normalize

        Returns:
            Normalized URL
        """
        # Remove fragment
        url = url.split('#')[0]

        # Ensure https
        url = url.replace('http://', 'https://')

        # Remove trailing slash for consistency
        url = url.rstrip('/')

        return url

    def url_to_filename(self, url: str) -> str:
        """
        Convert URL to safe filename.

        Args:
            url: The URL to convert

        Returns:
            Safe filename (without extension)
        """
        parsed = urlparse(url)
        path = parsed.path.strip('/')

        if not path:
            path = 'index'

        # Remove file extensions
        path = re.sub(r'\.(html?|php|aspx?)$', '', path, flags=re.IGNORECASE)

        # Replace path separators with dashes
        path = path.replace('/', '-')

        # Clean up: keep only alphanumeric, dash, underscore
        path = re.sub(r'[^\w\-]', '-', path)
        path = re.sub(r'-+', '-', path)  # Collapse multiple dashes
        path = path.strip('-')

        return path or 'index'

    def clean_content(self, soup: BeautifulSoup) -> BeautifulSoup:
        """
        Remove navigation, scripts, and other non-content elements.

        Args:
            soup: BeautifulSoup object to clean

        Returns:
            Cleaned BeautifulSoup object
        """
        # Remove script, style, and navigation elements
        for element in soup.find_all([
            'script', 'style', 'nav', 'footer', 'header',
            'iframe', 'noscript', 'svg', 'aside'
        ]):
            element.decompose()

        # Remove common navigation classes/IDs
        selectors_to_remove = [
            '.navigation', '.menu', '.sidebar', '.breadcrumb',
            '#nav', '#menu', '#sidebar', '.footer', '#footer',
            '.site-header', '.site-footer', '#site-navigation',
            '.widget', '.comment-form', '#comments',
            '.wp-block-navigation', '.entry-footer',
            '.social-share', '.related-posts'
        ]

        for selector in selectors_to_remove:
            for elem in soup.select(selector):
                elem.decompose()

        return soup

    def extract_main_content(self, soup: BeautifulSoup) -> Optional[BeautifulSoup]:
        """
        Find the main content area of a page.

        Args:
            soup: BeautifulSoup object

        Returns:
            Main content element or None
        """
        # Try common content selectors in priority order
        selectors = [
            'main',
            'article',
            '[role="main"]',
            '.content',
            '.entry-content',
            '.post-content',
            '#content',
            '.main-content'
        ]

        for selector in selectors:
            content = soup.select_one(selector)
            if content:
                return content

        # Fallback to body
        return soup.find('body')

    def extract_links(self, soup: BeautifulSoup, current_url: str) -> List[str]:
        """
        Extract all valid internal links from a page.

        Args:
            soup: BeautifulSoup object
            current_url: The current page URL (for resolving relative links)

        Returns:
            List of absolute URLs
        """
        links = []

        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']

            # Make absolute
            absolute_url = urljoin(current_url, href)

            # Normalize
            absolute_url = self.normalize_url(absolute_url)

            # Skip if should skip or already visited
            if self.should_skip_url(absolute_url):
                continue
            if absolute_url in self.visited:
                continue

            links.append(absolute_url)

        return list(set(links))  # Deduplicate

    def fetch_page(self, url: str, timeout: int = 30) -> Optional[str]:
        """
        Fetch a page with error handling.

        Args:
            url: URL to fetch
            timeout: Request timeout in seconds

        Returns:
            HTML content or None if failed
        """
        try:
            response = self.session.get(url, timeout=timeout)
            response.raise_for_status()
            return response.text

        except requests.exceptions.Timeout:
            self.errors.append({'url': url, 'error': 'Timeout'})
            print(f"  [ERROR] Timeout: {url}")
            return None

        except requests.exceptions.HTTPError as e:
            self.errors.append({'url': url, 'error': f'HTTP {e.response.status_code}'})
            print(f"  [ERROR] HTTP {e.response.status_code}: {url}")
            return None

        except Exception as e:
            self.errors.append({'url': url, 'error': str(e)})
            print(f"  [ERROR] {e}")
            return None

    def crawl_page(self, url: str, depth: int) -> None:
        """
        Crawl a single page.

        Args:
            url: URL to crawl
            depth: Current depth from seed URL
        """
        url = self.normalize_url(url)

        if url in self.visited:
            return

        if self.pages_crawled >= self.max_pages:
            return

        print(f"\n[{self.pages_crawled + 1}/{self.max_pages}] Depth {depth}: {url}")

        # Fetch page
        html = self.fetch_page(url)
        if not html:
            return

        # Mark as visited
        self.visited.add(url)
        self.pages_crawled += 1

        # Parse HTML
        soup = BeautifulSoup(html, 'html.parser')

        # Extract title
        title_elem = soup.find('title')
        title = title_elem.get_text(strip=True) if title_elem else url

        # Clean content
        soup_clean = self.clean_content(soup)

        # Find main content
        main_content = self.extract_main_content(soup_clean)
        if not main_content:
            print(f"  [WARNING] No main content found")
            return

        # Convert to markdown
        markdown = self.h2t.handle(str(main_content))

        # Clean up excessive whitespace
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)

        # Add metadata header
        metadata = f"""---
url: {url}
title: {title}
crawled: {datetime.now().isoformat()}
depth: {depth}
---

# {title}

"""

        markdown = metadata + markdown

        # Save to file
        filename = self.url_to_filename(url)
        filepath = self.output_dir / f"{filename}.md"

        # Handle duplicate filenames
        counter = 1
        while filepath.exists():
            filepath = self.output_dir / f"{filename}_{counter}.md"
            counter += 1

        filepath.write_text(markdown, encoding='utf-8')
        self.saved_files.append(str(filepath))
        self.url_to_file[url] = str(filepath)

        print(f"  [OK] Saved: {filepath.name}")

        # Extract and queue new links (if within depth limit)
        if depth < self.max_depth:
            # Use original soup for link extraction (before cleaning)
            soup_links = BeautifulSoup(html, 'html.parser')
            new_links = self.extract_links(soup_links, url)

            for link in new_links:
                if link not in self.visited:
                    self.queue.append((link, depth + 1, 1))  # priority 1

            print(f"  -> Found {len(new_links)} new links")

        # Be polite
        time.sleep(self.crawl_delay)

    def crawl(self) -> Dict:
        """
        Main crawl loop.

        Returns:
            Summary dictionary with crawl statistics
        """
        print(f"\n{'=' * 60}")
        print(f"Starting {self.__class__.__name__}")
        print(f"{'=' * 60}")

        # Get seed URLs
        seed_urls = self.get_seed_urls()
        print(f"Seed URLs: {len(seed_urls)}")

        # Initialize queue with seed URLs
        for url in seed_urls:
            if not self.should_skip_url(url):
                self.queue.append((url, 0, 0))  # depth 0, priority 0

        # Sort by priority
        self.queue.sort(key=lambda x: x[2])

        print(f"Starting crawl with {len(self.queue)} URLs in queue\n")

        # Process queue
        while self.queue and self.pages_crawled < self.max_pages:
            url, depth, _ = self.queue.pop(0)

            if url not in self.visited:
                self.crawl_page(url, depth)

        # Generate summary
        summary = self.save_summary()

        print(f"\n{'=' * 60}")
        print("Crawl Complete!")
        print(f"  Pages crawled: {self.pages_crawled}")
        print(f"  Files saved: {len(self.saved_files)}")
        print(f"  Errors: {len(self.errors)}")
        print(f"{'=' * 60}")

        return summary

    def save_summary(self) -> Dict:
        """
        Save crawl summary to JSON file.

        Returns:
            Summary dictionary
        """
        summary = {
            'crawl_date': datetime.now().isoformat(),
            'base_url': self.base_url,
            'pages_crawled': self.pages_crawled,
            'files_saved': len(self.saved_files),
            'max_depth': self.max_depth,
            'urls_found': len(self.visited),
            'errors': self.errors,
            'files': self.saved_files
        }

        summary_file = self.output_dir / 'crawl_summary.json'
        summary_file.write_text(json.dumps(summary, indent=2))

        print(f"\nSummary saved to: {summary_file}")

        return summary
