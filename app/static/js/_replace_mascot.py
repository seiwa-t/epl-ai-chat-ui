import re, sys, os

target = os.path.join(os.path.dirname(__file__), "script.js")
source = os.path.join(os.path.dirname(__file__), "_mascot_new.js")

with open(source, "r", encoding="utf-8") as f:
    new_src = f.read()

# Extract the block after "const _MASCOT_CHARS = "
m = re.search(r"const\s+_MASCOT_CHARS\s*=\s*", new_src)
if not m:
    print("ERROR: Cannot find _MASCOT_CHARS in source file")
    sys.exit(1)
new_block_start = m.end()

# Find matching brace
depth = 0
i = new_block_start
while i < len(new_src):
    if new_src[i] == '{':
        depth += 1
    elif new_src[i] == '}':
        depth -= 1
        if depth == 0:
            break
    i += 1
new_block = new_src[new_block_start:i+1]

with open(target, "r", encoding="utf-8") as f:
    script = f.read()

# Find _MASCOT_CHARS in script.js
m2 = re.search(r"const\s+_MASCOT_CHARS\s*=\s*", script)
if not m2:
    print("ERROR: Cannot find _MASCOT_CHARS in target file")
    sys.exit(1)
old_block_start = m2.end()

depth = 0
j = old_block_start
while j < len(script):
    if script[j] == '{':
        depth += 1
    elif script[j] == '}':
        depth -= 1
        if depth == 0:
            break
    j += 1
old_block = script[old_block_start:j+1]

print(f"Old block: {len(old_block)} chars, {old_block.count(chr(10))} lines")
print(f"New block: {len(new_block)} chars, {new_block.count(chr(10))} lines")

script_new = script[:old_block_start] + new_block + script[j+1:]

with open(target, "w", encoding="utf-8") as f:
    f.write(script_new)

print("Replacement complete!")
