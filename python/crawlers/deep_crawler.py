#!/usr/bin/env python3
"""
Deep Crawler - Comprehensive site crawling with sitemap support

This crawler demonstrates advanced techniques for thorough site crawling:
- XML sitemap parsing (including sitemap indices)
- Priority-based URL queuing
- Depth-aware breadth-first traversal
- PDF link extraction for separate processing
- Metadata generation for downstream ingestion

Production considerations:
- Respects robots.txt (check before deploying)
- Configurable rate limiting
- Graceful error handling
- Memory-efficient queue management

Author: Scott Anderson
"""

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse, parse_qs
from datetime import datetime
from pathlib import Path
import time
import json
import xml.etree.ElementTree as ET
import html2text
import re
import hashlib
from typing import List, Dict, Optional, Tuple

from base_crawler import BaseCrawler


class DeepCrawler(BaseCrawler):
    """
    A comprehensive crawler that uses sitemaps and deep link following.

    Features:
    - Sitemap.xml parsing with index sitemap support
    - Priority URL patterns (forms, policies, help pages)
    - PDF document link extraction
    - Query parameter handling for filtered pages
    - Duplicate detection via content hashing
    """

    def __init__(
        self,
        base_url: str,
        output_dir: Path,
        sitemap_url: Optional[str] = None,
        max_pages: int = 2000,
        max_depth: int = 4,
        crawl_delay: float = 0.5,
        priority_patterns: Optional[List[str]] = None
    ):
        """
        Initialize the deep crawler.

        Args:
            base_url: Root URL of the site
            output_dir: Directory to save output
            sitemap_url: URL of sitemap.xml (defaults to base_url/sitemap.xml)
            max_pages: Maximum pages to crawl
            max_depth: Maximum link depth
            crawl_delay: Delay between requests
            priority_patterns: URL patterns to prioritize (crawl first)
        """
        super().__init__(
            base_url=base_url,
            output_dir=output_dir,
            max_pages=max_pages,
            max_depth=max_depth,
            crawl_delay=crawl_delay,
            user_agent='DocumentCrawler/1.0 (Deep crawl for search indexing)'
        )

        self.sitemap_url = sitemap_url or f"{base_url.rstrip('/')}/sitemap.xml"
        self.sitemap_urls: List[str] = []
        self.pdf_links: List[Dict] = []  # Track PDF documents found

        # URL patterns to prioritize (crawl these first)
        self.priority_patterns = priority_patterns or [
            '/forms/',
            '/policies/',
            '/procedures/',
            '/resources/',
            '/help/',
            '/faq/',
            '/guide/',
            '/how-to/',
        ]

        print(f"  Sitemap: {self.sitemap_url}")
        print(f"  Priority patterns: {len(self.priority_patterns)}")

    def is_priority_url(self, url: str) -> bool:
        """Check if URL matches priority patterns."""
        url_lower = url.lower()
        return any(pattern in url_lower for pattern in self.priority_patterns)

    def url_to_filename(self, url: str) -> str:
        """
        Convert URL to safe filename, handling query parameters.

        For URLs with query parameters (e.g., filtered views),
        creates unique filenames using MD5 hash of params.
        """
        parsed = urlparse(url)
        path = parsed.path.strip('/')

        if not path:
            path = 'index'

        # Remove file extensions
        path = re.sub(r'\.(html?|php|aspx?)$', '', path, flags=re.IGNORECASE)

        # Replace slashes with dashes
        path = path.replace('/', '-')

        # Handle query parameters (for filtered/paginated pages)
        if parsed.query:
            query_hash = hashlib.md5(parsed.query.encode()).hexdigest()[:8]
            path = f"{path}-{query_hash}"

        # Clean up
        path = re.sub(r'[^\w\-]', '-', path)
        path = re.sub(r'-+', '-', path)
        path = path.strip('-')

        return path or 'index'

    def parse_sitemap(self) -> List[str]:
        """
        Parse sitemap.xml to get seed URLs.

        Handles both:
        - Regular sitemaps with <url> elements
        - Sitemap indices with <sitemap> elements pointing to sub-sitemaps

        Returns:
            List of URLs from sitemap
        """
        print(f"\nFetching sitemap: {self.sitemap_url}")

        try:
            response = self.session.get(self.sitemap_url, timeout=30)
            response.raise_for_status()

            content = response.content.decode('utf-8', errors='ignore')
            urls = []

            # Define namespace (standard sitemap namespace)
            namespace = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

            # Check if this is a sitemap index
            if '<sitemapindex' in content:
                print("  Found sitemap index, parsing sub-sitemaps...")

                root = ET.fromstring(response.content)
                sub_sitemaps = []

                for sitemap in root.findall('.//ns:sitemap', namespace):
                    loc = sitemap.find('ns:loc', namespace)
                    if loc is not None:
                        sub_sitemaps.append(loc.text)

                print(f"  Found {len(sub_sitemaps)} sub-sitemaps")

                # Fetch each sub-sitemap
                for sitemap_url in sub_sitemaps:
                    try:
                        print(f"  Fetching: {sitemap_url}")
                        sub_response = self.session.get(sitemap_url, timeout=30)
                        sub_response.raise_for_status()

                        sub_root = ET.fromstring(sub_response.content)
                        for url_elem in sub_root.findall('.//ns:url', namespace):
                            loc = url_elem.find('ns:loc', namespace)
                            if loc is not None:
                                urls.append(loc.text)

                        time.sleep(0.5)  # Be polite between sitemap fetches

                    except Exception as e:
                        print(f"  [WARNING] Error parsing {sitemap_url}: {e}")

            else:
                # Regular sitemap
                root = ET.fromstring(response.content)

                for url_elem in root.findall('.//ns:url', namespace):
                    loc = url_elem.find('ns:loc', namespace)
                    if loc is not None:
                        urls.append(loc.text)

            print(f"  Total URLs from sitemap: {len(urls)}")
            self.sitemap_urls = urls
            return urls

        except Exception as e:
            print(f"  [ERROR] Sitemap parsing failed: {e}")
            print(f"  Falling back to base URL only")
            return [self.base_url]

    def get_seed_urls(self) -> List[str]:
        """
        Get initial URLs from sitemap, sorted by priority.

        Returns:
            List of seed URLs with priority URLs first
        """
        urls = self.parse_sitemap()

        # Separate priority and regular URLs
        priority_urls = [u for u in urls if self.is_priority_url(u)]
        regular_urls = [u for u in urls if not self.is_priority_url(u)]

        print(f"  Priority URLs: {len(priority_urls)}")
        print(f"  Regular URLs: {len(regular_urls)}")

        # Return priority URLs first
        return priority_urls + regular_urls

    def extract_pdf_links(self, soup: BeautifulSoup) -> List[Dict]:
        """
        Extract PDF document links from page.

        These are tracked separately for downstream processing
        (e.g., PDF text extraction, separate indexing).

        Args:
            soup: BeautifulSoup object

        Returns:
            List of PDF link dictionaries
        """
        pdfs = []

        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if href.lower().endswith('.pdf'):
                absolute_url = urljoin(self.base_url, href)
                pdfs.append({
                    'url': absolute_url,
                    'text': a_tag.get_text(strip=True),
                    'found_on': 'current_page'  # Will be updated during crawl
                })

        return pdfs

    def crawl_page(self, url: str, depth: int) -> None:
        """
        Crawl a single page with PDF extraction.

        Extends base crawl_page to also extract PDF links.
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

        # Extract PDF links before cleaning
        pdfs = self.extract_pdf_links(soup)
        for pdf in pdfs:
            pdf['found_on'] = url
            self.pdf_links.append(pdf)

        # Extract title
        title_elem = soup.find('title')
        title = title_elem.get_text(strip=True) if title_elem else url

        # Clean content
        soup_clean = self.clean_content(BeautifulSoup(html, 'html.parser'))

        # Find main content
        main_content = self.extract_main_content(soup_clean)
        if not main_content:
            print(f"  [WARNING] No main content found")
            return

        # Convert to markdown
        markdown = self.h2t.handle(str(main_content))
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

        # Add PDF links section if any found
        if pdfs:
            markdown += "\n\n## Related Documents\n\n"
            for pdf in pdfs:
                markdown += f"- [{pdf['text']}]({pdf['url']})\n"

        # Save to file
        filename = self.url_to_filename(url)
        filepath = self.output_dir / f"{filename}.md"

        counter = 1
        while filepath.exists():
            filepath = self.output_dir / f"{filename}_{counter}.md"
            counter += 1

        filepath.write_text(markdown, encoding='utf-8')
        self.saved_files.append(str(filepath))
        self.url_to_file[url] = str(filepath)

        print(f"  [OK] Saved: {filepath.name}")
        if pdfs:
            print(f"  [INFO] Found {len(pdfs)} PDF links")

        # Extract and queue new links
        if depth < self.max_depth:
            new_links = self.extract_links(soup, url)

            for link in new_links:
                if link not in self.visited:
                    # Priority URLs get priority 0, others get 1
                    priority = 0 if self.is_priority_url(link) else 1
                    self.queue.append((link, depth + 1, priority))

            # Re-sort by priority
            self.queue.sort(key=lambda x: x[2])
            print(f"  -> Found {len(new_links)} new links")

        time.sleep(self.crawl_delay)

    def save_summary(self) -> Dict:
        """Save crawl summary including PDF links."""
        summary = {
            'crawl_date': datetime.now().isoformat(),
            'base_url': self.base_url,
            'sitemap_url': self.sitemap_url,
            'pages_crawled': self.pages_crawled,
            'files_saved': len(self.saved_files),
            'pdf_links_found': len(self.pdf_links),
            'max_depth': self.max_depth,
            'urls_in_sitemap': len(self.sitemap_urls),
            'urls_visited': len(self.visited),
            'errors': self.errors,
            'files': self.saved_files,
            'pdf_links': self.pdf_links[:100]  # Limit for JSON size
        }

        # Save main summary
        summary_file = self.output_dir / 'crawl_summary.json'
        summary_file.write_text(json.dumps(summary, indent=2))

        # Save metadata for ingestion pipeline
        metadata = {
            'crawledAt': datetime.now().isoformat(),
            'baseUrl': self.base_url,
            'files': [
                {
                    'filename': Path(filepath).name,
                    'url': url,
                    'title': self._extract_title_from_file(filepath)
                }
                for url, filepath in self.url_to_file.items()
            ]
        }

        metadata_file = self.output_dir / '_metadata.json'
        metadata_file.write_text(json.dumps(metadata, indent=2))

        # Save PDF links separately for document processor
        if self.pdf_links:
            pdf_file = self.output_dir / 'pdf_links.json'
            pdf_file.write_text(json.dumps(self.pdf_links, indent=2))
            print(f"  PDF links saved to: {pdf_file}")

        print(f"  Summary saved to: {summary_file}")
        print(f"  Metadata saved to: {metadata_file}")

        return summary

    def _extract_title_from_file(self, filepath: str) -> str:
        """Extract title from markdown file frontmatter."""
        try:
            content = Path(filepath).read_text(encoding='utf-8')
            match = re.search(r'^title:\s*(.+)$', content, re.MULTILINE)
            if match:
                return match.group(1).strip()
        except:
            pass
        return Path(filepath).stem.replace('-', ' ').title()


# Example usage and CLI
if __name__ == '__main__':
    import sys

    # Configuration
    BASE_URL = 'https://docs.example.com'
    OUTPUT_DIR = Path('./output/docs-site')

    # Parse command line arguments
    if len(sys.argv) > 1:
        BASE_URL = sys.argv[1]

    if len(sys.argv) > 2:
        OUTPUT_DIR = Path(sys.argv[2])

    # Create and run crawler
    crawler = DeepCrawler(
        base_url=BASE_URL,
        output_dir=OUTPUT_DIR,
        max_pages=500,
        max_depth=4,
        crawl_delay=0.5,
        priority_patterns=[
            '/help/',
            '/guide/',
            '/faq/',
            '/tutorial/'
        ]
    )

    try:
        summary = crawler.crawl()
        print(f"\nCrawl completed successfully!")
        print(f"Output directory: {OUTPUT_DIR}")
    except KeyboardInterrupt:
        print("\n\nCrawl interrupted by user")
        crawler.save_summary()
        print(f"Partial results saved: {crawler.pages_crawled} pages")
