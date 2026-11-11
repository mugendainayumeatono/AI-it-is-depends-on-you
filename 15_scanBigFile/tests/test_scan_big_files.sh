#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/scan_big_files.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        fail "$msg (expected to find '$needle' in:
$haystack)"
    fi
}
assert_not_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        fail "$msg (expected NOT to find '$needle' in:
$haystack)"
    fi
}
assert_line_match() {
    local haystack="$1" regex="$2" msg="$3"
    if ! printf '%s\n' "$haystack" | grep -Eq -- "$regex"; then
        fail "$msg (expected line matching '$regex' in:
$haystack)"
    fi
}
assert_no_line_match() {
    local haystack="$1" regex="$2" msg="$3"
    if printf '%s\n' "$haystack" | grep -Eq -- "$regex"; then
        fail "$msg (expected NO line matching '$regex' in:
$haystack)"
    fi
}

# Test 1: Invalid directory returns non-zero
if "$SCAN_SCRIPT" "/nonexistent_dir_12345" >/dev/null 2>&1; then
    fail "Expected non-zero exit code for nonexistent directory"
fi

# Test 2: Mock df and lsblk dynamic detection (no hardcoded /mnt or /media required)
MOCK_BIN="$(mktemp -d)"
TEST_ROOT="$(mktemp -d -p "$SCRIPT_DIR" .tmp_test_scan.XXXXXX)"
trap 'rm -rf "$MOCK_BIN" "$TEST_ROOT"' EXIT

cat > "$MOCK_BIN/df" <<EOF
#!/usr/bin/env bash
cat <<'DF_OUT'
Filesystem               Type          1024-blocks     Used        Available Capacity Mounted on
/dev/sda2                ext4             20466256 13485732          5915564      70% /
/dev/sda1                ext3               588752   344248           213504      62% /boot
/dev/sdb1                ext4             50000000 10000000         40000000      20% /mnt/local_data_disk
JuiceFS:my-r2-jfs        fuse.juicefs 1099511627776  3460300    1099508167476       1% /mnt/jfs
remote-storage:banwagong fuse.rclone  1099511627776        0    1099511627776       0% /custom_cloud/r2
10.0.0.5:/export/nas     nfs4           1000000000  5000000        995000000       1% /nas_share
/dev/sdc1                vfat             16000000  1000000         15000000       7% /usb_stick
remote:ext               fuse.rclone     100000000        0        100000000       0% $TEST_ROOT/fake_external_mount
DF_OUT
EOF
chmod +x "$MOCK_BIN/df"

cat > "$MOCK_BIN/lsblk" <<'EOF'
#!/usr/bin/env bash
cat <<'LSBLK_OUT'
/ 0 sata 0
/boot 0 sata 0
/mnt/local_data_disk 0 sata 0
/usb_stick 1 usb 1
LSBLK_OUT
EOF
chmod +x "$MOCK_BIN/lsblk"

# Source script in library mode to test detect_excluded_mounts directly
source "$SCAN_SCRIPT" --source-only
EXCLUDES="$(DF_CMD="$MOCK_BIN/df" LSBLK_CMD="$MOCK_BIN/lsblk" detect_excluded_mounts "/")"

assert_contains "$EXCLUDES" "/proc" "Should exclude /proc"
assert_contains "$EXCLUDES" "/sys" "Should exclude /sys"
assert_contains "$EXCLUDES" "/mnt/jfs" "Should exclude fuse.juicefs mount"
assert_contains "$EXCLUDES" "/custom_cloud/r2" "Should exclude fuse.rclone mount at arbitrary path"
assert_contains "$EXCLUDES" "/nas_share" "Should exclude nfs4 mount"
assert_contains "$EXCLUDES" "/usb_stick" "Should exclude removable USB mount from lsblk"
assert_not_contains "$EXCLUDES" "/mnt/local_data_disk" "Should NOT exclude local non-removable ext4 disk under /mnt"
assert_not_contains "$EXCLUDES" "/boot" "Should NOT exclude /boot"

echo "Task 1 tests passed!"

# Task 2 Integration Tests with real fallocate fixtures (>500M folders and >100M files)
# 1. Multi-level ancestor chain deduplication:
#    chain/lvl1/lvl2/leaf_dir = 550M (>500M)
#    chain/lvl1/lvl2 adds 10M (total 560M, own 10M <= 500M) -> should NOT be reported
#    chain/lvl1 adds 10M (total 570M, own 20M <= 500M) -> should NOT be reported
mkdir -p "$TEST_ROOT/chain/lvl1/lvl2/leaf_dir"
fallocate -l 550M "$TEST_ROOT/chain/lvl1/lvl2/leaf_dir/leaf_550m.bin"
fallocate -l 10M  "$TEST_ROOT/chain/lvl1/lvl2/mid_10m.bin"
fallocate -l 10M  "$TEST_ROOT/chain/lvl1/top_10m.bin"

# 2. Parent with its own >500M content PLUS a >500M child:
#    both_big/child_big = 520M (>500M)
#    both_big adds 530M directly (total 1050M, own 530M > 500M) -> BOTH should be reported
mkdir -p "$TEST_ROOT/both_big/child_big"
fallocate -l 520M "$TEST_ROOT/both_big/child_big/child_520m.bin"
fallocate -l 530M "$TEST_ROOT/both_big/parent_own_530m.bin"

# 3. Folder >500M composed exclusively of files <100M:
#    many_small_files has six 90M files = 540M total (>500M), each file <100M
mkdir -p "$TEST_ROOT/many_small_files"
for i in 1 2 3 4 5 6; do
    fallocate -l 90M "$TEST_ROOT/many_small_files/part_${i}_90m.bin"
done

# 4. Path with spaces containing a 150M file (>100M file, but folder <500M):
mkdir -p "$TEST_ROOT/folder with spaces"
fallocate -l 150M "$TEST_ROOT/folder with spaces/big file 150M.bin"

# 5. Excluded external mount inside TEST_ROOT containing 600M file:
mkdir -p "$TEST_ROOT/fake_external_mount/inside_mount"
fallocate -l 600M "$TEST_ROOT/fake_external_mount/inside_mount/ignored_600m.bin"

OUTPUT="$(DF_CMD="$MOCK_BIN/df" LSBLK_CMD="$MOCK_BIN/lsblk" "$SCAN_SCRIPT" "$TEST_ROOT")"

# Verify header shows excluded external mount
assert_contains "$OUTPUT" "$TEST_ROOT/fake_external_mount" "Header should list dynamically excluded mount"

# Extract sections
FOLDERS_SECTION="$(printf '%s\n' "$OUTPUT" | awk '/\[1\/2\]/{flag=1; next} /\[2\/2\]/{flag=0} flag')"
FILES_SECTION="$(printf '%s\n' "$OUTPUT" | awk '/\[2\/2\]/{flag=1; next} flag')"

# Verify Folder (>500M) section:
assert_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/chain/lvl1/lvl2/leaf_dir$" "leaf_dir (550M) must be listed"
assert_no_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/chain/lvl1/lvl2$" "lvl2 (only +10M over leaf_dir) must NOT be listed"
assert_no_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/chain/lvl1$" "lvl1 (only +20M over leaf_dir) must NOT be listed"
assert_no_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/chain$" "chain (only +20M over leaf_dir) must NOT be listed"
assert_no_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT$" "TEST_ROOT itself (only +150M outside big subdirs) must NOT be listed"

assert_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/both_big$" "both_big (1050M total, 530M own) must be listed"
assert_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/both_big/child_big$" "child_big (520M) must be listed"

assert_line_match "$FOLDERS_SECTION" "[[:space:]]$TEST_ROOT/many_small_files$" "many_small_files (6x90M = 540M) must be listed"
assert_no_line_match "$FOLDERS_SECTION" "fake_external_mount" "Excluded mount folder must NOT be listed in folders section"
assert_no_line_match "$FOLDERS_SECTION" "folder with spaces" "150M folder must NOT be listed in >500M folders section"

# Verify descending sort order in Folders section: both_big (~1.02G) must appear before leaf_dir (550M) and child_big (520M)
BOTH_BIG_LINE="$(printf '%s\n' "$FOLDERS_SECTION" | grep -n -F "$TEST_ROOT/both_big" | head -n1 | cut -d: -f1)"
LEAF_DIR_LINE="$(printf '%s\n' "$FOLDERS_SECTION" | grep -n -F "$TEST_ROOT/chain/lvl1/lvl2/leaf_dir" | head -n1 | cut -d: -f1)"
if [[ -z "$BOTH_BIG_LINE" || -z "$LEAF_DIR_LINE" || "$BOTH_BIG_LINE" -ge "$LEAF_DIR_LINE" ]]; then
    fail "Expected both_big (~1.02G) to be sorted before leaf_dir (550M)"
fi

# Verify File (>100M) section:
assert_line_match "$FILES_SECTION" "[[:space:]]$TEST_ROOT/chain/lvl1/lvl2/leaf_dir/leaf_550m\.bin$" "550M file must be listed"
assert_line_match "$FILES_SECTION" "[[:space:]]$TEST_ROOT/both_big/parent_own_530m\.bin$" "530M file must be listed"
assert_line_match "$FILES_SECTION" "[[:space:]]$TEST_ROOT/both_big/child_big/child_520m\.bin$" "520M file must be listed"
assert_line_match "$FILES_SECTION" "[[:space:]]$TEST_ROOT/folder with spaces/big file 150M\.bin$" "150M file with spaces must be listed"

assert_no_line_match "$FILES_SECTION" "part_.*_90m\.bin" "90M files must NOT be listed in >100M files section"
assert_no_line_match "$FILES_SECTION" "ignored_600m\.bin" "File inside excluded mount must NOT be listed"

# Verify descending sort order in Files section: 550M file before 150M file
FILE_550_LINE="$(printf '%s\n' "$FILES_SECTION" | grep -n -F "leaf_550m.bin" | head -n1 | cut -d: -f1)"
FILE_150_LINE="$(printf '%s\n' "$FILES_SECTION" | grep -n -F "big file 150M.bin" | head -n1 | cut -d: -f1)"
if [[ -z "$FILE_550_LINE" || -z "$FILE_150_LINE" || "$FILE_550_LINE" -ge "$FILE_150_LINE" ]]; then
    fail "Expected 550M file to be sorted before 150M file"
fi

echo "Task 2 tests passed!"
