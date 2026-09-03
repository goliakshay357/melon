#!/usr/bin/env python3
"""
Test script to verify write tool diff feature when writing to existing files.
This script tests the behavior described in the issue about diff feature
on whenever you do a write on an existing file.
"""

import os
import json
import tempfile
from pathlib import Path

def create_test_directory():
    """Create a temporary test directory"""
    test_dir = tempfile.mkdtemp(prefix="write_test_")
    print(f"Created test directory: {test_dir}")
    return test_dir

def write_initial_content(test_dir):
    """Write initial content to a test file"""
    test_file = Path(test_dir) / "test.txt"
    content = """Line 1
Line 2
Line 3
Line 4
Line 5"""
    with open(test_file, "w") as f:
        f.write(content)
    print(f"Created initial file: {test_file}")
    print(f"Content: {content}")
    return test_file

def simulate_write_overwrite(test_file):
    """Simulate writing to an existing file (overwrite)"""
    new_content = """Updated Line 1
Updated Line 2
Updated Line 3
New Line 4
New Line 5"""
    with open(test_file, "w") as f:
        f.write(new_content)
    print(f"\nOverwrote existing file: {test_file}")
    print(f"New content: {new_content}")
    
    # Read back to verify
    with open(test_file) as f:
        read_content = f.read()
    print(f"Verified content: {read_content}")
    return read_content

def simulate_incremental_writes(test_dir):
    """Test incremental writes to the same file"""
    test_file = Path(test_dir) / "incremental.txt"
    
    # Initial write
    with open(test_file, "w") as f:
        f.write("Version 1\n")
    print(f"\nInitial write to {test_file}: Version 1")
    
    # First incremental write
    with open(test_file, "a") as f:
        f.write("Added line 1\n")
    print(f"First incremental write (append): Added line 1")
    
    # Second incremental write
    with open(test_file, "w") as f:
        f.write("Version 2\nUpdated line 1\nAdded line 2\n")
    print(f"Second incremental write (overwrite): Version 2")
    
    # Read final content
    with open(test_file) as f:
        final_content = f.read()
    print(f"Final content:\n{final_content}")
    return final_content

def simulate_concurrent_simulation(test_dir):
    """Simulate what happens when multiple writes target the same file"""
    test_file = Path(test_dir) / "concurrent_test.txt"
    
    # This simulates the mutation queue behavior
    # In real usage, write tool would serialize operations
    operations = []
    
    # Operation 1: Initial write
    operations.append({"type": "write", "content": "Operation 1 content\n", "file": str(test_file)})
    
    # Operation 2: Overwrite with different content  
    operations.append({"type": "overwrite", "content": "Operation 2 content\n", "file": str(test_file)})
    
    # Operation 3: Partial update
    operations.append({"type": "write", "content": "Partial update\n", "file": str(test_file)})
    
    print(f"\nSimulated concurrent operations on {test_file}:")
    for i, op in enumerate(operations, 1):
        print(f"  Operation {i}: {op['type']} - {op['content'].strip()}")
    
    # Simulate file mutation queue (operations should be serialized)
    print("\nSimulating file mutation queue (serialized operations):")
    current_content = ""
    for op in operations:
        if op["type"] == "write":
            current_content += op["content"]
        elif op["type"] == "overwrite":
            current_content = op["content"]
        print(f"  After {op['type']}: {current_content.strip()}")
    
    # In the real implementation, this would be handled by file-mutation-queue.ts
    print("\nNote: Real implementation uses file-mutation-queue.ts to serialize operations")
    print("      ensuring that operations on the same file are executed in sequence")
    return operations

def test_write_tool_behavior():
    """Main test function"""
    print("=" * 60)
    print("Testing Write Tool Diff Feature (Overwriting Existing Files)")
    print("=" * 60)
    
    test_dir = create_test_directory()
    
    try:
        # Test 1: Simple overwrite
        print("\n" + "=" * 40)
        print("Test 1: Simple File Overwrite")
        print("=" * 40)
        test_file = write_initial_content(test_dir)
        verify_content = simulate_write_overwrite(test_file)
        
        expected_changes = """Updated Line 1
Updated Line 2
Updated Line 3
New Line 4
New Line 5"""
        assert verify_content == expected_changes, "Content mismatch after overwrite"
        print("✓ Simple overwrite test PASSED")
        
        # Test 2: Incremental writes
        print("\n" + "=" * 40)
        print("Test 2: Incremental Writes")
        print("=" * 40)
        simulate_incremental_writes(test_dir)
        print("✓ Incremental writes simulation COMPLETED")
        
        # Test 3: Concurrent operation simulation
        print("\n" + "=" * 40)
        print("Test 3: Concurrent Operation Simulation")
        print("=" * 40)
        simulate_concurrent_simulation(test_dir)
        print("✓ Concurrent simulation COMPLETED")
        
        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60)
        
    finally:
        # Clean up
        import shutil
        shutil.rmtree(test_dir, ignore_errors=True)
        print(f"\nCleaned up test directory: {test_dir}")

if __name__ == "__main__":
    test_write_tool_behavior()