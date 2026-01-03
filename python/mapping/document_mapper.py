#!/usr/bin/env python3
"""
Document Mapper - Cross-reference system with fuzzy matching

This module provides intelligent document linking capabilities:
- Multi-strategy document matching (URL, filename, title)
- Fuzzy string matching with confidence scoring
- Index-based fast lookups
- Relationship metadata generation

Use cases:
- Link web pages to related downloadable documents
- Detect when a page is a navigation portal vs content page
- Build document relationship graphs for enhanced retrieval

Author: Scott Allen
"""

import json
import os
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup


class DocumentMapper:
    """
    Cross-references documents across multiple sources using fuzzy matching.

    Features:
    - Multiple index types: by filename, title, and URL
    - Fuzzy title matching using SequenceMatcher
    - Confidence scoring for match quality
    - Relationship metadata generation
    - Efficient indexing for fast lookups

    The mapper builds indices at initialization and provides
    O(1) lookups for exact matches, with fallback to O(n) fuzzy matching.
    """

    def __init__(self, doc_directories: Optional[List[str]] = None):
        """
        Initialize the document mapper and build indices.

        Args:
            doc_directories: List of directories to scan for documents.
                           If None, uses default paths.
        """
        self.doc_directories = doc_directories or [
            './docs/processed',
            './docs/crawled',
            './docs/uploads'
        ]

        # Index structures
        self.filename_index: Dict[str, str] = {}  # lowercase filename -> full path
        self.title_index: Dict[str, str] = {}     # normalized title -> full path
        self.url_index: Dict[str, str] = {}       # source URL -> full path

        # Build indices
        self._build_indices()

    def _build_indices(self) -> None:
        """
        Scan directories and build lookup indices.

        Creates three index types:
        1. Filename index: For exact filename matching
        2. Title index: For title-based lookups
        3. URL index: For source URL matching (from frontmatter)
        """
        print("Building document indices...")
        total_files = 0

        for doc_dir in self.doc_directories:
            doc_path = Path(doc_dir)
            if not doc_path.exists():
                continue

            for root, _, files in os.walk(doc_path):
                for file in files:
                    if file.endswith('.md'):
                        full_path = Path(root) / file
                        total_files += 1

                        # Index by filename (lowercase for case-insensitive matching)
                        self.filename_index[file.lower()] = str(full_path)

                        # Index by normalized title (extracted from filename)
                        title = self._normalize_title(file.replace('.md', ''))
                        self.title_index[title] = str(full_path)

                        # Try to extract source URL from file content
                        try:
                            with open(full_path, 'r', encoding='utf-8') as f:
                                # Only read first 1000 chars for efficiency
                                content = f.read(1000)
                                source_url = self._extract_source_url(content)
                                if source_url:
                                    self.url_index[source_url] = str(full_path)
                        except:
                            pass

        print(f"  Indexed {total_files} documents")
        print(f"  By filename: {len(self.filename_index)}")
        print(f"  By title: {len(self.title_index)}")
        print(f"  By URL: {len(self.url_index)}")

    def _normalize_title(self, title: str) -> str:
        """
        Normalize title for consistent comparison.

        Transformations:
        - Lowercase
        - Remove special characters
        - Normalize whitespace
        - URL decode

        Args:
            title: Raw title string

        Returns:
            Normalized title
        """
        # Remove special characters, keep alphanumeric and spaces
        title = re.sub(r'[^\w\s-]', '', title.lower())
        # Normalize separators to spaces
        title = re.sub(r'[-_\s]+', ' ', title)
        # URL decode
        title = unquote(title)
        return title.strip()

    def _extract_source_url(self, content: str) -> Optional[str]:
        """
        Extract source URL from markdown frontmatter or content.

        Looks for common patterns:
        - YAML frontmatter url: field
        - Dropbox URLs
        - Google Drive URLs

        Args:
            content: Document content (first portion)

        Returns:
            Source URL or None
        """
        # Try YAML frontmatter
        url_match = re.search(r'^url:\s*(.+)$', content, re.MULTILINE)
        if url_match:
            return url_match.group(1).strip()

        # Try Dropbox URL
        dropbox_match = re.search(r'https://[^\s\)]*dropbox\.com[^\s\)]*', content)
        if dropbox_match:
            # Remove query params for cleaner matching
            return dropbox_match.group(0).split('?')[0]

        # Try Google Drive URL
        drive_match = re.search(r'https://drive\.google\.com[^\s\)]*', content)
        if drive_match:
            return drive_match.group(0).split('?')[0]

        return None

    def find_matching_document(
        self,
        link_url: str,
        link_text: str = ''
    ) -> Tuple[Optional[str], float, str]:
        """
        Find existing document matching a link.

        Uses multiple matching strategies in order of confidence:
        1. Exact URL match (confidence: 1.0)
        2. Exact filename match (confidence: 0.95)
        3. Partial filename match (confidence: 0.85)
        4. Exact title match (confidence: 0.80)
        5. Fuzzy title match (confidence: varies, min 0.70)

        Args:
            link_url: URL of the link to match
            link_text: Display text of the link

        Returns:
            Tuple of (local_file_path, confidence_score, match_type)
        """
        # Strategy 1: Exact URL match (highest confidence)
        if 'dropbox.com' in link_url or 'drive.google.com' in link_url:
            clean_url = link_url.split('?')[0]
            if clean_url in self.url_index:
                return (self.url_index[clean_url], 1.0, 'url_exact')

        # Strategy 2 & 3: Filename matching
        parsed = urlparse(link_url)
        url_filename = os.path.basename(parsed.path)

        if url_filename:
            url_filename_lower = url_filename.lower()

            # Try exact filename match (with extension conversion)
            if url_filename_lower.endswith('.pdf'):
                md_filename = url_filename_lower.replace('.pdf', '.md')
                if md_filename in self.filename_index:
                    return (self.filename_index[md_filename], 0.95, 'filename_exact')

            # Try partial filename match
            for filename, path in self.filename_index.items():
                if url_filename_lower in filename or filename in url_filename_lower:
                    return (path, 0.85, 'filename_partial')

        # Strategy 4 & 5: Title matching (from link text)
        if link_text:
            normalized_text = self._normalize_title(link_text)

            # Exact title match
            if normalized_text in self.title_index:
                return (self.title_index[normalized_text], 0.80, 'title_exact')

            # Fuzzy title match
            best_match = None
            best_score = 0.70  # Minimum threshold

            for title, path in self.title_index.items():
                # Use SequenceMatcher for fuzzy comparison
                score = SequenceMatcher(None, normalized_text, title).ratio()
                if score > best_score:
                    best_score = score
                    best_match = path

            if best_match:
                return (best_match, best_score, 'title_fuzzy')

        # No match found
        return (None, 0.0, 'no_match')

    def extract_document_links(self, html_content: str, page_url: str) -> List[Dict]:
        """
        Extract all document links from HTML and find matching local files.

        Identifies links to:
        - PDF files
        - Office documents (doc, docx, xls, xlsx, ppt, pptx)
        - Cloud storage (Dropbox, Google Drive, SharePoint)

        Args:
            html_content: HTML page content
            page_url: URL of the page (for resolving relative links)

        Returns:
            List of document link dictionaries with match info
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        document_links = []

        # Patterns indicating document links
        doc_patterns = [
            r'\.pdf$',
            r'\.docx?$',
            r'\.xlsx?$',
            r'\.pptx?$',
            r'dropbox\.com',
            r'drive\.google\.com',
            r'sharepoint\.com'
        ]

        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            text = a_tag.get_text(strip=True)

            # Check if this matches any document pattern
            is_document = any(
                re.search(pattern, href, re.IGNORECASE)
                for pattern in doc_patterns
            )

            if is_document:
                # Find matching local file
                local_file, confidence, match_type = self.find_matching_document(href, text)

                document_links.append({
                    'url': href,
                    'text': text,
                    'local_file': local_file,
                    'confidence': confidence,
                    'match_type': match_type
                })

        return document_links

    def generate_relationship_metadata(
        self,
        page_url: str,
        page_title: str,
        document_links: List[Dict]
    ) -> Dict:
        """
        Generate metadata describing page's relationships to documents.

        Classifies pages as:
        - 'content': Regular content page with few/no document links
        - 'navigation': Page that primarily links to documents (portal)

        Args:
            page_url: URL of the page
            page_title: Title of the page
            document_links: List of document link dictionaries

        Returns:
            Relationship metadata dictionary
        """
        linked_docs = []
        high_confidence_matches = []

        for link in document_links:
            if link['local_file']:
                linked_docs.append({
                    'document_url': link['url'],
                    'document_text': link['text'],
                    'local_file': link['local_file'],
                    'confidence': link['confidence'],
                    'match_type': link['match_type']
                })

                if link['confidence'] >= 0.85:
                    high_confidence_matches.append(link['local_file'])

        # Determine page type based on document link density
        is_portal = len(high_confidence_matches) >= 3
        page_type = 'navigation' if is_portal else 'content'

        return {
            'page_url': page_url,
            'page_title': page_title,
            'page_type': page_type,
            'linked_documents': linked_docs,
            'linked_document_count': len(linked_docs),
            'high_confidence_matches': high_confidence_matches,
            'is_document_portal': is_portal
        }

    def get_stats(self) -> Dict:
        """
        Get index statistics.

        Returns:
            Dictionary with index sizes
        """
        return {
            'total_by_filename': len(self.filename_index),
            'total_by_title': len(self.title_index),
            'total_by_url': len(self.url_index),
            'directories_scanned': len(self.doc_directories)
        }


def demo():
    """Demonstrate document mapper functionality."""
    print("\n" + "=" * 60)
    print("Document Mapper Demo")
    print("=" * 60)

    # Initialize mapper
    mapper = DocumentMapper(doc_directories=['./docs'])

    # Show stats
    stats = mapper.get_stats()
    print(f"\nIndex Statistics:")
    for key, value in stats.items():
        print(f"  {key}: {value}")

    # Test matching
    test_links = [
        ('https://storage.example.com/docs/UserGuide.pdf', 'User Guide'),
        ('https://example.com/files/QuickStart.pdf', 'Quick Start Guide'),
        ('https://dropbox.com/s/abc123/FAQ.pdf', 'Frequently Asked Questions')
    ]

    print("\nTesting Link Matching:")
    print("-" * 60)

    for url, text in test_links:
        local_file, confidence, match_type = mapper.find_matching_document(url, text)

        print(f"\nURL: {url}")
        print(f"Text: {text}")
        print(f"Match: {local_file or 'No match'}")
        print(f"Confidence: {confidence:.2f} ({match_type})")


if __name__ == '__main__':
    demo()
