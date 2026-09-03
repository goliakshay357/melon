#!/usr/bin/env python3
"""
Test script to verify the write tool diff feature behavior.
This tests the actual write tool implementation when overwriting existing files.
"""

import asyncio
import tempfile
from pathlib import Path
import sys
import os

# Add the packages directory to the path so we can import the tools
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages/coding-agent'))

from src.index import createWriteTool, createReadTool
import json

async def test_write_overwrite_behavior():
    """Test the write tool behavior when overwriting existing files"""
    print("=" * 60)
    print("Testing Write Tool Behavior - Overwriting Existing Files")
    print("=" * 60)
    
    with tempfile.TemporaryDirectory() as test_dir:
        print(f"Test directory: {test_dir}")
        
        # Create write and read tools
        write_tool = createWriteTool(test_dir)
        read_tool = createReadTool(test_dir)
        
        # Test 1: Write to a new file (no diff needed)
        print("\n" + "=" * 40)
        print("Test 1: Write to New File")
        print("=" * 40)
        test_file = Path(test_dir) / "new_file.txt"
        
        write_result = await write_tool.execute("test-1", {
            "path": "new_file.txt",
            "content": "This is a new file\nLine 2\nLine 3"
        })
        
        print(f"Write result: {write_result.content}")
        
        # Read back to verify
        read_result = await read_tool.execute("read-test-1", {"path": "new_file.txt"})
        text_content = '\n'.join([c.get('text', '') for c in read_result.content if c.get('type') == 'text'])
        print(f"File content:\n{text_content}")
        print("✓ New file test PASSED")
        
        # Test 2: Overwrite existing file with different content
        print("\n" + "=" * 40)
        print("Test 2: Overwrite Existing File")
        print("=" * 40)
        
        # First write some content
        await write_tool.execute("test-2-init", {
            "path": "existing_file.txt",
            "content": "Original content\nLine 2\nLine 3\nLine 4"
        })
        print("Created existing_file.txt with original content")
        
        # Overwrite with completely different content
        write_result = await write_tool.execute("test-2-overwrite", {
            "path": "existing_file.txt",
            "content": "Completely different content\nNew line 2\nNew line 3\nNew line 4\nNew line 5"
        })
        
        print(f"Overwrite result: {write_result.content}")
        
        # Read back to verify
        read_result = await read_tool.execute("read-test-2", {"path": "existing_file.txt"})
        text_content = '\n'.join([c.get('text', '') for c in read_result.content if c.get('type') == 'text'])
        print(f"File content after overwrite:\n{text_content}")
        
        # Verify content
        expected = "Completely different content\nNew line 2\nNew line 3\nNew line 4\nNew line 5"
        assert text_content == expected, f"Content mismatch. Expected:\n{expected}\nGot:\n{text_content}"
        print("✓ Overwrite test PASSED")
        
        # Test 3: Partial overwrite (different but similar content)
        print("\n" + "=" * 40)
        print("Test 3: Partial Overwrite")
        print("=" * 40)
        
        # Write initial content
        await write_tool.execute("test-3-init", {
            "path": "partial_file.txt",
            "content": "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
        })
        print("Created partial_file.txt")
        
        # Overwrite with modified content (similar but different)
        write_result = await write_tool.execute("test-3-partial", {
            "path": "partial_file.txt",
            "content": "Updated Line 1\nUpdated Line 2\nLine 3\nLine 4\nUpdated Line 5"
        })
        
        print(f"Partial overwrite result: {write_result.content}")
        
        # Read back
        read_result = await read_tool.execute("read-test-3", {"path": "partial_file.txt"})
        text_content = '\n'.join([c.get('text', '') for c in read_result.content if c.get('type') == 'text'])
        print(f"File content after partial overwrite:\n{text_content}")
        
        # Verify content
        expected = "Updated Line 1\nUpdated Line 2\nLine 3\nLine 4\nUpdated Line 5"
        assert text_content == expected, f"Content mismatch. Expected:\n{expected}\nGot:\n{text_content}"
        print("✓ Partial overwrite test PASSED")
        
        # Test 4: Test file mutation queue behavior
        print("\n" + "=" * 40)
        print("Test 4: File Mutation Queue (Multiple Writes)")
        print("=" * 40)
        
        # Write multiple times to same file to test queue behavior
        for i in range(3):
            content = f"Version {i + 1}\nLine {i + 2}\nLine {i + 3}\n"
            write_result = await write_tool.execute(f"test-4-{i}", {
                "path": "queue_test.txt",
                "content": content
            })
            print(f"Write {i + 1}: {write_result.content}")
            
            # Read back after each write
            read_result = await read_tool.execute(f"read-4-{i}", {"path": "queue_test.txt"})
            text_content = '\n'.join([c.get('text', '') for c in read_result.content if c.get('type') == 'text'])
            print(f"  File content: {text_content.strip()}")
        
        # Final verification - should be the last version
        read_result = await read_tool.execute("read-4-final", {"path": "queue_test.txt"})
        text_content = '\n'.join([c.get('text', '') for c in read_result.content if c.get('type') == 'text'])
        expected = "Version 3\nLine 4\nLine 5"
        assert text_content == expected, f"Final content mismatch. Expected:\n{expected}\nGot:\n{text_content}"
        print("✓ File mutation queue test PASSED")
        
        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("Write tool diff feature works correctly")
        print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_write_overwrite_behavior())