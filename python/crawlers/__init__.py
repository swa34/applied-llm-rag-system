"""
Web Crawlers for Document Extraction

This package provides production-ready web crawlers for extracting
content from various sources and converting to markdown for RAG ingestion.

Classes:
    BaseCrawler: Abstract base class with common crawling functionality
    DeepCrawler: Sitemap-aware comprehensive site crawler
    AuthenticatedCrawler: Secure crawler with multi-domain token support

Author: Scott Allen
"""

from .authenticated_crawler import AuthenticatedCrawler
from .base_crawler import BaseCrawler
from .deep_crawler import DeepCrawler

__all__ = ['BaseCrawler', 'DeepCrawler', 'AuthenticatedCrawler']
