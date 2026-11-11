#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/scan_big_files.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        fail "$msg (expected to find '$needle' in: $haystack)"
    fi
}
assert_not_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        fail "$msg (expected NOT to find '$needle' in: $haystack)"
    fi
}

# Test 1: Invalid directory returns non-zero
if "$SCAN_SCRIPT" "/nonexistent_dir_12345" >/dev/null 2>&1; then
    fail "Expected non-zero exit code for nonexistent directory"
fi

# Test 2: Mock df and lsblk dynamic detection (no hardcoded /mnt or /media required)
MOCK_BIN="$(mktemp -d)"
trap 'rm -rf "$MOCK_BIN"' EXIT

cat > "$MOCK_BIN/df" <<'EOF'
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
