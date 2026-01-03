#!/usr/bin/env python3
"""
Authenticated Crawler - Secure crawling with multi-domain token support

This crawler demonstrates production techniques for authenticated crawling:
- Multi-domain authentication token management
- Redirect detection without following (prevents auth loops)
- Rate limiting with lockout prevention
- Session pooling with keep-alive
- Document relationship mapping
- Download handling for embedded documents

Security considerations:
- Never follows redirects to login pages
- Tracks auth failures per domain to prevent lockout
- Configurable failure thresholds
- Safe credential handling

Author: Scott Allen
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import html2text
import requests
from bs4 import BeautifulSoup

# Import document utilities (optional, for cross-referencing)
try:
    from ..mapping.document_mapper import DocumentMapper
    HAS_MAPPER = True
except ImportError:
    HAS_MAPPER = False


class AuthenticatedCrawler:
    """
    A production-grade crawler for authenticated websites.

    Features:
    - Multi-domain token management
    - Redirect detection and blocking (prevents login loops)
    - Per-domain auth failure tracking (prevents lockout)
    - Document link extraction and downloading
    - Relationship metadata generation
    - Connection pooling for efficiency

    This is designed for enterprise intranets where:
    - Different subdomains may require different tokens
    - Login redirects must be detected and blocked
    - Rate limits must be strictly respected
    """

    def __init__(
        self,
        start_url: str,
        output_dir: str,
        auth_tokens: Optional[Dict[str, str]] = None,
        allowed_domains: Optional[List[str]] = None,
        max_pages: int = 500,
        max_depth: int = 10,
        crawl_delay: float = 2.0,
        max_auth_failures: int = 5
    ):
        """
        Initialize the authenticated crawler.

        Args:
            start_url: Starting URL for the crawl
            output_dir: Directory to save crawled content
            auth_tokens: Dict mapping domain -> token
            allowed_domains: List of domains allowed to crawl
            max_pages: Maximum pages to crawl
            max_depth: Maximum link depth
            crawl_delay: Seconds between requests
            max_auth_failures: Max auth failures before blocking domain
        """
        self.start_url = start_url
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Authentication configuration
        self.auth_tokens = auth_tokens or {}
        self.auth_header = 'X-Crawl-Token'  # Custom header for token

        # Domains
        base_domain = urlparse(start_url).netloc
        self.allowed_domains = allowed_domains or [base_domain]

        # Crawl settings
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.crawl_delay = crawl_delay
        self.max_auth_failures = max_auth_failures

        # State tracking
        self.visited = set()
        self.queue: List[Tuple[str, int]] = [(start_url, 0)]
        self.pages_crawled = 0
        self.saved_files: List[Dict] = []

        # Auth failure tracking (prevents account lockout)
        self.auth_failures: Dict[str, int] = {}

        # Document mapper for cross-referencing (optional)
        self.doc_mapper = None
        if HAS_MAPPER:
            try:
                self.doc_mapper = DocumentMapper()
                print("Document mapper initialized")
            except:
                pass

        # HTTP session with connection pooling
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'IntranetCrawler/1.0 (Authenticated)'
        })

        # Connection pooling for efficiency
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=20,
            max_retries=3,
            pool_block=False
        )
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

        # HTML to Markdown converter
        self.h2t = html2text.HTML2Text()
        self.h2t.ignore_links = False
        self.h2t.ignore_images = False
        self.h2t.ignore_emphasis = False
        self.h2t.body_width = 0

        # Skip patterns
        self.skip_patterns = [
            '/wp-admin/',
            '/wp-login',
            '/wp-json/',
            '/wp-content/uploads/',  # Large media files
            '/feed/',
            '/tag/',
            '/author/',
            '?replytocom=',
            '?print=',
            '.pdf', '.doc', '.docx',
            '.xls', '.xlsx', '.ppt', '.pptx'
        ]

        print(f"Authenticated Crawler Initialized")
        print(f"  Start URL: {start_url}")
        print(f"  Allowed domains: {self.allowed_domains}")
        print(f"  Auth tokens configured: {len(self.auth_tokens)} domains")
        print(f"  Max pages: {max_pages}")
        print(f"  Crawl delay: {crawl_delay}s")
        print("-" * 60)

    def get_token_for_domain(self, url: str) -> Optional[str]:
        """
        Get the appropriate auth token for a URL's domain.

        Args:
            url: The URL to get token for

        Returns:
            Auth token or None
        """
        domain = urlparse(url).netloc
        return self.auth_tokens.get(domain)

    def is_allowed_domain(self, url: str) -> bool:
        """Check if URL is within allowed domains."""
        try:
            domain = urlparse(url).netloc
            return any(
                domain == d or domain.endswith(f'.{d}')
                for d in self.allowed_domains
            )
        except:
            return False

    def should_crawl(self, url: str) -> bool:
        """Check if URL should be crawled."""
        if url in self.visited:
            return False

        if not self.is_allowed_domain(url):
            return False

        return not any(p in url.lower() for p in self.skip_patterns)

    def is_domain_blocked(self, url: str) -> bool:
        """Check if domain has too many auth failures."""
        domain = urlparse(url).netloc
        failures = self.auth_failures.get(domain, 0)
        return failures >= self.max_auth_failures

    def record_auth_failure(self, url: str) -> None:
        """Record an authentication failure for a domain."""
        domain = urlparse(url).netloc

        if domain not in self.auth_failures:
            self.auth_failures[domain] = 0
        self.auth_failures[domain] += 1

        if self.auth_failures[domain] >= self.max_auth_failures:
            print(f"  [CRITICAL] Domain {domain} blocked after {self.auth_failures[domain]} failures")

    def fetch_page(self, url: str, redirect_count: int = 0) -> Optional[str]:
        """
        Fetch page with authentication and redirect handling.

        Key security features:
        - Does NOT follow redirects automatically
        - Detects redirects to login pages and blocks
        - Tracks auth failures per domain
        - Prevents lockout from repeated failures

        Args:
            url: URL to fetch
            redirect_count: Current redirect count (prevents loops)

        Returns:
            HTML content or None if failed/blocked
        """
        MAX_REDIRECTS = 3

        if redirect_count > MAX_REDIRECTS:
            print(f"  [ERROR] Too many redirects ({redirect_count})")
            return None

        # Check if domain is blocked
        if self.is_domain_blocked(url):
            domain = urlparse(url).netloc
            print(f"  [BLOCKED] Domain {domain} - too many auth failures")
            return None

        try:
            # Get token for this domain
            token = self.get_token_for_domain(url)

            # Prepare headers
            headers = {
                'User-Agent': 'IntranetCrawler/1.0 (Authenticated)'
            }
            if token:
                headers[self.auth_header] = token

            print(f"\nFetching: {url}")

            # CRITICAL: Don't follow redirects - detect them
            response = self.session.get(
                url,
                headers=headers,
                timeout=30,
                allow_redirects=False  # Key for security
            )

            print(f"  Status: {response.status_code}")

            # Handle redirects manually
            if response.status_code in [301, 302, 303, 307, 308]:
                redirect_location = response.headers.get('Location', '')

                # Make absolute if relative
                if redirect_location.startswith('/'):
                    parsed = urlparse(url)
                    redirect_location = f"{parsed.scheme}://{parsed.netloc}{redirect_location}"

                print(f"  [REDIRECT] To: {redirect_location}")

                # Block redirects to login pages
                login_indicators = ['login', 'signin', 'sso', 'auth', 'oauth']
                if any(ind in redirect_location.lower() for ind in login_indicators):
                    print(f"  [ERROR] Redirect to login detected - NOT FOLLOWING")
                    print(f"  [ERROR] This prevents account lockout from failed attempts")
                    self.record_auth_failure(url)
                    return None

                # Follow safe same-domain redirects
                redirect_domain = urlparse(redirect_location).netloc
                original_domain = urlparse(url).netloc

                if redirect_domain == original_domain:
                    print(f"  [INFO] Following same-domain redirect...")
                    time.sleep(1)
                    return self.fetch_page(redirect_location, redirect_count + 1)
                else:
                    print(f"  [WARNING] Cross-domain redirect blocked")
                    return None

            # Check for access denied
            if response.status_code in [401, 403]:
                print(f"  [ERROR] Access denied (HTTP {response.status_code})")
                self.record_auth_failure(url)
                return None

            if response.status_code != 200:
                print(f"  [ERROR] HTTP {response.status_code}")
                return None

            # Check for login form in content (auth bypassed but failed)
            login_indicators = [
                '<form name="loginform"',
                'class="login-form"',
                'id="loginform"',
                'type="password"'
            ]
            if any(ind in response.text.lower() for ind in login_indicators):
                print(f"  [ERROR] Got login form - authentication failed")
                self.record_auth_failure(url)
                return None

            return response.text

        except requests.exceptions.Timeout:
            print(f"  [ERROR] Request timeout")
            return None
        except requests.exceptions.ConnectionError as e:
            print(f"  [ERROR] Connection error: {e}")
            return None
        except Exception as e:
            print(f"  [ERROR] Unexpected: {e}")
            return None

    def clean_content(self, soup: BeautifulSoup) -> BeautifulSoup:
        """Remove navigation and non-content elements."""
        for selector in [
            'nav', 'header', 'footer',
            '.nav', '.menu', '.navigation', '.sidebar',
            '.breadcrumb', '.comments', '#comments',
            '.social-share', 'script', 'style'
        ]:
            for element in soup.select(selector):
                element.decompose()
        return soup

    def extract_links(self, soup: BeautifulSoup, base_url: str) -> List[str]:
        """Extract all valid internal links."""
        links = []
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            absolute_url = urljoin(base_url, href).split('#')[0]

            if self.should_crawl(absolute_url):
                links.append(absolute_url)

        return list(set(links))

    def extract_document_links(self, soup: BeautifulSoup) -> List[Dict]:
        """
        Extract document links (PDFs, Office files, cloud storage).

        Returns:
            List of document link dictionaries
        """
        doc_patterns = [
            r'\.pdf$',
            r'\.docx?$',
            r'\.xlsx?$',
            r'\.pptx?$',
            r'dropbox\.com',
            r'drive\.google\.com',
            r'sharepoint\.com'
        ]

        documents = []
        import re

        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            text = a_tag.get_text(strip=True)

            is_doc = any(re.search(p, href, re.IGNORECASE) for p in doc_patterns)

            if is_doc:
                documents.append({
                    'url': href,
                    'text': text
                })

        return documents

    def extract_content(self, html: str, url: str) -> Tuple[str, str, List[str], Dict]:
        """
        Extract content, links, and document relationships.

        Returns:
            Tuple of (title, markdown, links, relationship_metadata)
        """
        soup = BeautifulSoup(html, 'html.parser')

        # Get title
        title_elem = soup.find('title')
        title = title_elem.get_text(strip=True) if title_elem else urlparse(url).path

        # Extract links BEFORE cleaning
        links = self.extract_links(soup, url)

        # Extract document links
        doc_links = self.extract_document_links(soup)

        # Generate relationship metadata
        relationship_metadata = {
            'linked_documents': doc_links,
            'linked_document_count': len(doc_links),
            'page_type': 'navigation' if len(doc_links) >= 3 else 'content'
        }

        # Now clean for markdown extraction
        soup_clean = BeautifulSoup(html, 'html.parser')
        soup_clean = self.clean_content(soup_clean)

        # Find main content
        main_content = None
        for selector in ['main', 'article', '.content', '.entry-content', '#content', 'body']:
            main_content = soup_clean.select_one(selector)
            if main_content:
                break

        if not main_content:
            return None, None, [], {}

        # Convert to markdown
        try:
            markdown = self.h2t.handle(str(main_content))
        except:
            markdown = main_content.get_text()

        return title, markdown, links, relationship_metadata

    def save_content(self, title: str, url: str, markdown: str, metadata: Dict) -> str:
        """Save content to markdown file."""
        # Create safe filename
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.split('/') if p]

        if path_parts:
            filename = '_'.join(path_parts[:3])
        else:
            filename = 'index'

        # Sanitize filename
        filename = ''.join(c for c in filename if c.isalnum() or c in '-_')
        filename = filename[:100]

        filepath = self.output_dir / f"{filename}.md"

        # Handle duplicates
        counter = 1
        while filepath.exists():
            filepath = self.output_dir / f"{filename}_{counter}.md"
            counter += 1

        # Build content
        full_content = f"""# {title}

**Source:** {url}
**Crawled:** {datetime.now().isoformat()}
**Page Type:** {metadata.get('page_type', 'content')}
**Linked Documents:** {metadata.get('linked_document_count', 0)}

---

{markdown}
"""

        # Add linked documents section
        if metadata.get('linked_documents'):
            full_content += "\n\n## Related Documents\n\n"
            for doc in metadata['linked_documents']:
                full_content += f"- [{doc['text']}]({doc['url']})\n"

        filepath.write_text(full_content, encoding='utf-8')
        print(f"  [OK] Saved: {filepath.name}")

        return str(filepath)

    def crawl(self) -> Dict:
        """Main crawl loop."""
        print(f"\n{'=' * 60}")
        print("Starting Authenticated Crawl")
        print(f"{'=' * 60}\n")

        while self.queue and self.pages_crawled < self.max_pages:
            url, depth = self.queue.pop(0)

            if url in self.visited or depth > self.max_depth:
                continue

            self.visited.add(url)

            print(f"\n[Depth {depth}] [{self.pages_crawled + 1}/{self.max_pages}]")

            # Fetch page
            html = self.fetch_page(url)
            if not html:
                continue

            # Extract content
            title, markdown, links, metadata = self.extract_content(html, url)

            if not markdown or len(markdown.strip()) < 100:
                print(f"  [WARNING] Content too short, skipping")
                continue

            # Save content
            filepath = self.save_content(title, url, markdown, metadata)
            self.saved_files.append({
                'url': url,
                'title': title,
                'file': filepath,
                'metadata': metadata
            })
            self.pages_crawled += 1

            # Queue new links
            if depth < self.max_depth:
                new_links = [l for l in links if l not in self.visited]
                for link in new_links:
                    self.queue.append((link, depth + 1))
                print(f"  Added {len(new_links)} links to queue")

            # Rate limiting
            time.sleep(self.crawl_delay)

        # Save summary
        return self.save_summary()

    def save_summary(self) -> Dict:
        """Save crawl summary."""
        summary = {
            'crawled_at': datetime.now().isoformat(),
            'start_url': self.start_url,
            'total_pages': self.pages_crawled,
            'auth_failures_by_domain': self.auth_failures,
            'files': self.saved_files,
            'config': {
                'max_pages': self.max_pages,
                'max_depth': self.max_depth,
                'allowed_domains': self.allowed_domains
            }
        }

        summary_path = self.output_dir / 'crawl_summary.json'
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2)

        print(f"\n{'=' * 60}")
        print("Crawl Complete!")
        print(f"{'=' * 60}")
        print(f"  Pages crawled: {self.pages_crawled}")
        print(f"  Files saved: {len(self.saved_files)}")
        print(f"  Auth failures: {sum(self.auth_failures.values())}")
        print(f"  Summary: {summary_path}")

        return summary


def test_auth(url: str, token: str, header: str = 'X-Crawl-Token') -> bool:
    """Test authentication before crawling."""
    print(f"\n{'=' * 60}")
    print("Testing Authentication")
    print(f"{'=' * 60}")

    session = requests.Session()
    session.headers.update({
        header: token,
        'User-Agent': 'IntranetCrawler/1.0 (Testing)'
    })

    try:
        print(f"URL: {url}")
        print(f"Token: {token[:10]}...")

        response = session.get(url, timeout=30)

        print(f"Status: {response.status_code}")
        print(f"Content-Type: {response.headers.get('content-type', 'unknown')}")

        # Check for login indicators
        login_indicators = [
            '<form name="loginform"',
            'class="login-form"',
            'id="loginform"'
        ]

        if any(ind in response.text.lower() for ind in login_indicators):
            print("\n[FAILED] Got login page - authentication not working")
            return False
        else:
            print("\n[SUCCESS] Authentication working!")
            return True

    except Exception as e:
        print(f"\n[ERROR] {e}")
        return False


# Example usage
if __name__ == '__main__':
    import sys

    # Example configuration
    START_URL = 'https://intranet.example.com/'
    OUTPUT_DIR = './output/intranet'

    # Auth tokens per domain
    AUTH_TOKENS = {
        'intranet.example.com': 'your-auth-token-here',
        'secure.example.com': 'another-token-here'
    }

    # Parse command line
    if len(sys.argv) > 1:
        START_URL = sys.argv[1]

    # Test authentication first
    domain = urlparse(START_URL).netloc
    token = AUTH_TOKENS.get(domain, '')

    if token:
        if not test_auth(START_URL, token):
            print("\nAuthentication test failed!")
            if '--force' not in sys.argv:
                response = input("Continue anyway? (y/N): ")
                if response.lower() != 'y':
                    sys.exit(1)

    # Create and run crawler
    crawler = AuthenticatedCrawler(
        start_url=START_URL,
        output_dir=OUTPUT_DIR,
        auth_tokens=AUTH_TOKENS,
        allowed_domains=[domain],
        max_pages=100,
        crawl_delay=2.0
    )

    try:
        summary = crawler.crawl()
    except KeyboardInterrupt:
        print("\n\nCrawl interrupted")
        crawler.save_summary()
