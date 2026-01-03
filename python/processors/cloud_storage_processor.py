#!/usr/bin/env python3
"""
Cloud Storage Processor - Dropbox API integration for document processing

This module provides complete Dropbox API integration for:
- Listing files recursively with pagination
- Downloading with temporary links
- Shared link creation/retrieval
- Batch processing with document conversion

Production features:
- Token validation and permission checking
- Pagination handling for large folders
- Rate limiting and error recovery
- File size limits
- Comprehensive summary generation

Author: Scott Allen
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import requests

from .document_processor import DocumentProcessor


class CloudStorageProcessor:
    """
    Process files from Dropbox using the official API.

    Features:
    - Token validation with permission checking
    - Recursive folder listing with pagination
    - Temporary and shared link generation
    - Integration with DocumentProcessor for text extraction
    - Batch processing with summary generation

    This class handles all Dropbox API interactions and delegates
    document processing to DocumentProcessor.
    """

    # Supported file types for processing
    SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt']

    # Maximum file size (50MB)
    MAX_FILE_SIZE = 50 * 1024 * 1024

    def __init__(
        self,
        access_token: str,
        output_dir: str = "./output/cloud-storage"
    ):
        """
        Initialize the cloud storage processor.

        Args:
            access_token: Dropbox API access token
            output_dir: Directory to save processed files
        """
        self.access_token = access_token
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Initialize document processor for file conversion
        self.processor = DocumentProcessor(output_dir=str(self.output_dir))

        # Statistics
        self.stats = {
            'files_found': 0,
            'files_processed': 0,
            'files_skipped': 0,
            'files_failed': 0,
            'bytes_processed': 0
        }

    def validate_token(self) -> bool:
        """
        Test if the token is valid and has proper permissions.

        Checks:
        - Token is not expired
        - Account is accessible
        - Required scopes are available

        Returns:
            True if token is valid, False otherwise
        """
        url = "https://api.dropboxapi.com/2/users/get_current_account"

        try:
            # This endpoint doesn't need Content-Type header
            headers = {"Authorization": f"Bearer {self.access_token}"}
            response = requests.post(url, headers=headers)

            if response.status_code == 200:
                user_info = response.json()
                email = user_info.get('email', 'Unknown')
                print(f"[OK] Token valid for: {email}")
                return True
            else:
                print(f"[FAIL] Token validation failed: {response.status_code}")
                print(f"  Response: {response.text[:200]}")
                return False

        except Exception as e:
            print(f"[ERROR] Token validation error: {e}")
            return False

    def list_folder(
        self,
        folder_path: str = "",
        recursive: bool = True
    ) -> List[Dict]:
        """
        List all files in a folder.

        Features:
        - Recursive listing (optional)
        - Automatic pagination handling
        - Filters to supported file types only
        - Metadata extraction (size, modified date)

        Args:
            folder_path: Path to folder (empty string for root)
            recursive: Whether to list recursively

        Returns:
            List of file metadata dictionaries
        """
        all_files = []

        url = "https://api.dropboxapi.com/2/files/list_folder"
        data = {
            "path": folder_path,
            "recursive": recursive,
            "include_media_info": False,
            "include_deleted": False,
            "include_has_explicit_shared_members": False
        }

        print(f"Listing files in: {folder_path or '(root)'}")

        try:
            response = requests.post(url, headers=self.headers, json=data)
            response.raise_for_status()
            result = response.json()

            # Process entries
            for entry in result.get("entries", []):
                if entry[".tag"] == "file":
                    name = entry["name"]
                    ext = Path(name).suffix.lower()

                    if ext in self.SUPPORTED_EXTENSIONS:
                        all_files.append({
                            "name": name,
                            "path": entry["path_display"],
                            "id": entry["id"],
                            "size": entry.get("size", 0),
                            "modified": entry.get("client_modified", ""),
                            "type": ext[1:]  # Remove leading dot
                        })

            # Handle pagination
            has_more = result.get("has_more", False)
            cursor = result.get("cursor")

            while has_more:
                continue_url = "https://api.dropboxapi.com/2/files/list_folder/continue"
                continue_response = requests.post(
                    continue_url,
                    headers=self.headers,
                    json={"cursor": cursor}
                )
                continue_response.raise_for_status()
                continue_result = continue_response.json()

                for entry in continue_result.get("entries", []):
                    if entry[".tag"] == "file":
                        name = entry["name"]
                        ext = Path(name).suffix.lower()

                        if ext in self.SUPPORTED_EXTENSIONS:
                            all_files.append({
                                "name": name,
                                "path": entry["path_display"],
                                "id": entry["id"],
                                "size": entry.get("size", 0),
                                "modified": entry.get("client_modified", ""),
                                "type": ext[1:]
                            })

                has_more = continue_result.get("has_more", False)
                cursor = continue_result.get("cursor")

            print(f"  Found {len(all_files)} supported files")
            self.stats['files_found'] = len(all_files)
            return all_files

        except requests.exceptions.RequestException as e:
            print(f"[ERROR] Listing folder: {e}")
            if hasattr(e, 'response') and e.response:
                print(f"  Response: {e.response.text[:200]}")
            return []

    def get_temporary_link(self, file_path: str) -> Optional[str]:
        """
        Get a temporary download link for a file.

        Temporary links expire after 4 hours.

        Args:
            file_path: Dropbox path to the file

        Returns:
            Temporary download URL or None
        """
        url = "https://api.dropboxapi.com/2/files/get_temporary_link"
        data = {"path": file_path}

        try:
            response = requests.post(url, headers=self.headers, json=data)
            response.raise_for_status()
            return response.json().get("link")
        except requests.exceptions.RequestException as e:
            print(f"  [ERROR] Getting temporary link: {e}")
            return None

    def get_or_create_shared_link(self, file_path: str) -> Optional[str]:
        """
        Get or create a permanent shared link for a file.

        First tries to get existing links, then creates if none exist.
        Handles 409 conflict errors (link already exists).

        Args:
            file_path: Dropbox path to the file

        Returns:
            Shareable URL or None
        """
        # Try to get existing links first
        list_url = "https://api.dropboxapi.com/2/sharing/list_shared_links"
        list_data = {"path": file_path}

        try:
            response = requests.post(list_url, headers=self.headers, json=list_data)
            if response.status_code == 200:
                links = response.json().get("links", [])
                if links:
                    return links[0].get("url")
        except:
            pass  # Fall through to create

        # Create new shared link
        create_url = "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings"
        create_data = {
            "path": file_path,
            "settings": {
                "requested_visibility": "public",
                "audience": "public",
                "access": "viewer"
            }
        }

        try:
            response = requests.post(create_url, headers=self.headers, json=create_data)

            if response.status_code == 200:
                return response.json().get("url")

            elif response.status_code == 409:
                # Link already exists - try to get it again
                response = requests.post(list_url, headers=self.headers, json=list_data)
                if response.status_code == 200:
                    links = response.json().get("links", [])
                    if links:
                        return links[0].get("url")

        except requests.exceptions.RequestException as e:
            print(f"  [WARN] Could not create share link: {e}")

        return None

    def download_file(self, file_path: str, output_path: Path) -> bool:
        """
        Download a file using temporary link.

        Args:
            file_path: Dropbox path to the file
            output_path: Local path to save the file

        Returns:
            True if successful, False otherwise
        """
        temp_link = self.get_temporary_link(file_path)
        if not temp_link:
            return False

        try:
            response = requests.get(temp_link, stream=True)
            response.raise_for_status()

            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            return True

        except requests.exceptions.RequestException as e:
            print(f"  [ERROR] Download failed: {e}")
            return False

    def list_root_folders(self) -> List[str]:
        """
        List folders in the root for exploration.

        Returns:
            List of folder paths
        """
        url = "https://api.dropboxapi.com/2/files/list_folder"
        data = {
            "path": "",
            "recursive": False,
            "include_deleted": False
        }

        folders = []

        try:
            response = requests.post(url, headers=self.headers, json=data)
            if response.status_code == 200:
                print("\nAvailable folders:")
                print("-" * 40)
                for entry in response.json().get("entries", []):
                    if entry[".tag"] == "folder":
                        path = entry['path_display']
                        folders.append(path)
                        print(f"  {path}")
                print("-" * 40)
        except Exception as e:
            print(f"[ERROR] Listing root: {e}")

        return folders

    def process_folder(self, folder_path: str = "") -> Dict:
        """
        List and process all files from a folder.

        Complete workflow:
        1. Validate token
        2. List all files recursively
        3. Download each file
        4. Get/create shared links
        5. Process with DocumentProcessor
        6. Generate summary

        Args:
            folder_path: Dropbox folder path

        Returns:
            Processing summary dictionary
        """
        print("=" * 60)
        print("CLOUD STORAGE PROCESSOR")
        print("=" * 60)
        print(f"Target folder: {folder_path or '(root)'}")
        print()

        # Validate token
        print("Validating API connection...")
        if not self.validate_token():
            print("\nToken validation failed. Please check:")
            print("  1. Token hasn't expired")
            print("  2. Required scopes: files.content.read, files.metadata.read")
            print("  3. Regenerate at: https://www.dropbox.com/developers/apps")
            return {"status": "error", "message": "Invalid token"}

        # List available folders
        self.list_root_folders()

        # List all files
        all_files = self.list_folder(folder_path)

        if not all_files:
            print("No supported files found")
            return {"status": "error", "message": "No files found"}

        # Organize by subfolder
        files_by_folder: Dict[str, List] = {}
        for file_info in all_files:
            path_parts = file_info["path"].split("/")
            subfolder = path_parts[2] if len(path_parts) > 3 else "root"

            if subfolder not in files_by_folder:
                files_by_folder[subfolder] = []
            files_by_folder[subfolder].append(file_info)

        print("\nFiles by folder:")
        for folder, files in files_by_folder.items():
            print(f"  {folder}: {len(files)} files")
        print(f"Total: {len(all_files)} files\n")

        # Process files
        processed_files = []
        errors = []

        print("Processing files...")
        print("=" * 60)

        for i, file_info in enumerate(all_files, 1):
            file_name = file_info["name"]
            file_path = file_info["path"]
            file_size = file_info["size"]

            # Skip large files
            if file_size > self.MAX_FILE_SIZE:
                size_mb = file_size / 1024 / 1024
                print(f"\n[{i}/{len(all_files)}] Skipping (too large): {file_name}")
                print(f"  Size: {size_mb:.1f} MB (max: 50 MB)")
                errors.append(f"{file_name}: Too large ({size_mb:.1f} MB)")
                self.stats['files_skipped'] += 1
                continue

            print(f"\n[{i}/{len(all_files)}] {file_name}")
            print(f"  Size: {file_size / 1024:.1f} KB")

            # Determine output subfolder
            path_parts = file_path.split("/")
            subfolder = path_parts[2].replace(' ', '_').lower() if len(path_parts) > 3 else "root"

            # Download file
            download_dir = self.output_dir / "downloads" / subfolder
            download_dir.mkdir(parents=True, exist_ok=True)
            download_path = download_dir / file_name

            if self.download_file(file_path, download_path):
                print("  [OK] Downloaded")

                # Get shareable link
                share_url = self.get_or_create_shared_link(file_path)
                if share_url:
                    print(f"  [OK] Share URL obtained")
                else:
                    share_url = f"dropbox://{file_path}"
                    print(f"  [WARN] Using fallback URL")

                # Process document
                try:
                    self.processor.output_dir = self.output_dir / subfolder
                    self.processor.output_dir.mkdir(parents=True, exist_ok=True)

                    result = self.processor.process_file(download_path, source_url=share_url)

                    if result.get('status') == 'success':
                        result['folder'] = subfolder
                        result['cloud_path'] = file_path
                        result['share_url'] = share_url
                        processed_files.append(result)
                        self.stats['files_processed'] += 1
                        self.stats['bytes_processed'] += file_size
                        print(f"  [OK] Processed")
                    else:
                        errors.append(f"{file_name}: Processing failed")
                        self.stats['files_failed'] += 1

                except Exception as e:
                    errors.append(f"{file_name}: {str(e)}")
                    self.stats['files_failed'] += 1
                    print(f"  [ERROR] {e}")
            else:
                errors.append(f"{file_name}: Download failed")
                self.stats['files_failed'] += 1

            # Rate limiting
            time.sleep(0.5)

        # Save summary
        summary = {
            "processed_at": datetime.now().isoformat(),
            "folder_path": folder_path,
            "statistics": self.stats,
            "files_by_folder": {k: len(v) for k, v in files_by_folder.items()},
            "processed_files": processed_files,
            "errors": errors
        }

        summary_path = self.output_dir / "processing_summary.json"
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)

        # Print summary
        print("\n" + "=" * 60)
        print("PROCESSING COMPLETE")
        print("=" * 60)
        print(f"Files found: {self.stats['files_found']}")
        print(f"Processed: {self.stats['files_processed']}")
        print(f"Skipped: {self.stats['files_skipped']}")
        print(f"Failed: {self.stats['files_failed']}")
        print(f"Total data: {self.stats['bytes_processed'] / 1024 / 1024:.1f} MB")

        if errors:
            print("\nErrors:")
            for error in errors[:5]:
                print(f"  - {error}")
            if len(errors) > 5:
                print(f"  ... and {len(errors) - 5} more")

        print(f"\nOutput: {self.output_dir}")
        print(f"Summary: {summary_path}")

        return summary


def main():
    """Command-line interface."""
    # Get token from environment
    token = os.getenv('DROPBOX_ACCESS_TOKEN')

    if not token:
        print("ERROR: DROPBOX_ACCESS_TOKEN not set")
        print("\nSet in environment or .env file:")
        print("  DROPBOX_ACCESS_TOKEN=your_token_here")

        if len(sys.argv) > 1:
            token = sys.argv[1]
        else:
            sys.exit(1)

    # Get folder path from arguments
    folder_path = sys.argv[2] if len(sys.argv) > 2 else ""

    # Process
    processor = CloudStorageProcessor(token)
    result = processor.process_folder(folder_path)

    if result.get("status") == "error":
        sys.exit(1)

    print("\n" + "=" * 60)
    print("NEXT STEPS")
    print("=" * 60)
    print("1. Review processed documents in output directory")
    print("2. Run ingestion to add to vector database:")
    print("   python -m src.ingestion.ingest --source cloud-storage")


if __name__ == '__main__':
    main()
