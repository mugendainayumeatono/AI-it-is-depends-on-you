# System Big Folders (>500MB) and Big Files (>100MB) Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency Linux shell script (`scan_big_files.sh`) that scans for folders >500MB (with bottom-up parent-child deduplication) and files >100MB while dynamically detecting and excluding virtual filesystems and external storage mounts via `df` and `lsblk`.

**Architecture:** A single portable Bash script (`scan_big_files.sh`) organized into modular functions: dynamic mount exclusion discovery (`df -PT` + `lsblk`), bottom-up directory size aggregation and deduplication (`du` + `awk`), pruned large file discovery (`find -prune` + `awk`), and human-readable sorted reporting. Tested by an automated shell test suite (`tests/test_scan_big_files.sh`) using `fallocate` fixtures and mock `df`/`lsblk` commands.

**Tech Stack:** Bash, GNU coreutils (`df`, `du`, `sort`, `stat`), `findutils` (`find`), `gawk`/`awk`, `util-linux` (`lsblk`, `fallocate`).

**Spec:** `docs/superpowers/specs/2026-11-10-scan-big-files-design.md`

## Global Constraints

- Zero external third-party dependencies (standard Linux CLI utilities only).
- Do not hardcode `/mnt` or `/media` as excluded paths; dynamically detect external/network/FUSE/virtual mounts via `df -PT` and removable/USB devices via `lsblk`.
- Always exclude kernel pseudo-filesystems (`/proc`, `/sys`, `/dev`, `/run`).
- Folder threshold defaults to `> 500MB` (`500` MB); file threshold defaults to `> 100MB` (`100` MB).
- Deduplicate ancestor folders: an ancestor folder is only listed if its own effective size (total size minus the total sizes of its topmost selected `>500MB` descendants) is strictly `> 500MB`.
- Sort both folder and file sections in descending order by size and display human-readable units (`MB`/`GB`).
- Default scan target is `/`, with optional path argument `./scan_big_files.sh [target_dir]`.

## Review Focus

- Multi-level ancestor chain (`/a/b/c` where `c` is 600MB, `b` adds 10MB, `a` adds 10MB): subtracting `c` must prevent both `b` (610MB) and `a` (620MB) from being reported, whereas if `b` adds 550MB of its own (`b` total 1150MB), both `b` and `c` are reported while `a` (1160MB) is not.
- Folder `>500MB` composed of multiple files each `<100MB` (e.g., six 90MB files = 540MB): must be reported in the `>500MB` folder section even though zero files appear in the `>100MB` file section.
- Paths and filenames containing spaces (e.g., `my big folder/large file.bin`): must not break `df` parsing, `du`, `find`, or `awk` output formatting.
- Dynamic external storage detection via `df -PT` and `lsblk`: FUSE mounts (`fuse.juicefs`, `fuse.rclone`), network mounts (`nfs`, `cifs`), non-`/dev/` filesystems, and USB removable block devices (`RM=1` or `TRAN=usb`) must be excluded regardless of mount path (e.g., `/mnt/jfs`, `/data/remote_r2`, `/usb_disk`).
- Non-existent or invalid target directory argument: script must exit with non-zero status and print a clear error message to `stderr`.

---

### Task 1: Dynamic Mount Point Exclusion Discovery (`detect_excluded_mounts`)

**Files:**
- Create: `scan_big_files.sh`
- Create: `tests/test_scan_big_files.sh`

**Interfaces:**
- Produces in `scan_big_files.sh`:
  - Environment overrides for testability: `DF_CMD="${DF_CMD:-df}"`, `LSBLK_CMD="${LSBLK_CMD:-lsblk}"`, `FOLDER_MIN_MB="${FOLDER_MIN_MB:-500}"`, `FILE_MIN_MB="${FILE_MIN_MB:-100}"`.
  - `detect_excluded_mounts(target_dir)`: Outputs newline-separated canonical mount paths to exclude (combining `/proc`, `/sys`, `/dev`, `/run`, non-local mounts from `$DF_CMD -PT`, and removable/USB mounts from `$LSBLK_CMD -nrpo MOUNTPOINT,RM,TRAN,HOTPLUG`), never excluding `target_dir` itself or its parent mounts.

- [ ] **Step 1: Write failing tests for dynamic mount detection and CLI validation in `tests/test_scan_big_files.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/scan_big_files.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        fail "$msg (expected to find '$needle')"
    fi
}
assert_not_contains() {
    local haystack="$1" needle="$2" msg="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        fail "$msg (expected NOT to find '$needle')"
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/test_scan_big_files.sh`
Expected: FAIL (`scan_big_files.sh: No such file or directory`)

- [ ] **Step 3: Implement `detect_excluded_mounts` and CLI entrypoint skeleton in `scan_big_files.sh`**

Implement in `scan_big_files.sh`:
- Support `--source-only` flag so tests can source functions without running main scan.
- Validate target directory exists and is a directory (`[[ -d "$target_dir" ]]`), exiting with code 1 and message to `stderr` if not.
- Implement `detect_excluded_mounts(target_dir)`:
  - Always include `/proc`, `/sys`, `/dev`, `/run`.
  - Parse `$DF_CMD -PT 2>/dev/null | awk 'NR>1 { ... }'`:
    - Extract `fs=$1`, `fstype=$2`, and `mountpoint` (columns 7..NF joined by space to support spaces in mount paths).
    - Mark as excluded if:
      - `fs !~ /^\/dev\//` or `fs ~ /^\/dev\/loop/`, OR
      - `fstype ~ /^(fuse.*|nfs.*|cifs|smb.*|tmpfs|devtmpfs|squashfs|overlay|iso9660|udf|autofs|ceph|glusterfs|9p|davfs|sshfs|proc|sysfs|cgroup.*|debugfs|tracefs|securityfs|pstore|efivarfs|mqueue|hugetlbfs|binfmt_misc|configfs|fusectl)$/`
  - Parse `$LSBLK_CMD -nrpo MOUNTPOINT,RM,TRAN,HOTPLUG 2>/dev/null`:
    - When a line has a non-empty mountpoint and (`RM == 1` or `HOTPLUG == 1` or `TRAN == "usb"`), mark that mountpoint as excluded.
  - Filter out `/`, `target_dir` itself, and any ancestor prefix of `target_dir` so scanning a subdirectory inside a mount still works when explicitly requested. Deduplicate with `sort -u`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/test_scan_big_files.sh`
Expected: PASS (`Task 1 tests passed!`)

- [ ] **Step 5: Commit**

```bash
git add scan_big_files.sh tests/test_scan_big_files.sh
git commit -m "feat: implement dynamic mount exclusion discovery via df and lsblk"
```

---

### Task 2: Bottom-Up Folder (>500MB) Scanner & Pruned File (>100MB) Scanner

**Files:**
- Modify: `scan_big_files.sh`
- Modify: `tests/test_scan_big_files.sh`

**Interfaces:**
- Consumes: `detect_excluded_mounts`, `FOLDER_MIN_MB`, `FILE_MIN_MB`
- Produces in `scan_big_files.sh`:
  - `scan_big_folders(target_dir, excludes_newline_list)`: Runs `du -BM` with `--exclude` flags, applies bottom-up ancestor deduplication in `awk` for folders strictly `> FOLDER_MIN_MB`, formats sizes in human-readable units (`MB`/`GB`), and outputs sorted descending lines `<size_human>\t<path>`.
  - `scan_big_files(target_dir, excludes_newline_list)`: Runs `find` with `-path <ex> -prune -o -type f -size +${FILE_MIN_MB}M -printf "%s\t%p\n"`, converts byte sizes to human-readable `MB`/`GB`, and outputs sorted descending lines `<size_human>\t<path>`.
  - `main(args...)`: Prints scan header (target path, non-root notice if `EUID != 0`, excluded mounts), then `[1/2] 大于 500MB 的文件夹` and `[2/2] 大于 100MB 的文件`.

- [ ] **Step 1: Add integration tests in `tests/test_scan_big_files.sh` covering all folder/file scenarios and Review Focus cases**

Add test cases to `tests/test_scan_big_files.sh` using a temporary workspace directory and `fallocate`:
1. **Multi-level ancestor chain deduplication**:
   - `chain/lvl1/lvl2/leaf_dir`: contains a `550M` file (so `leaf_dir`, `lvl2`, `lvl1`, `chain` all have total size `>=550M`).
   - `chain/lvl1/lvl2` adds a `10M` file; `chain/lvl1` adds a `10M` file.
   - Expected: `chain/lvl1/lvl2/leaf_dir` IS in folder output; `chain/lvl1/lvl2` and `chain/lvl1` are NOT in folder output.
2. **Parent with its own >500MB content plus >500MB child**:
   - `both_big/child_big`: contains `520M` file.
   - `both_big`: also contains `530M` file directly in `both_big/own_large.bin`.
   - Expected: BOTH `both_big` (~1.0G) and `both_big/child_big` (520M) are in folder output, ordered with `both_big` before `both_big/child_big`.
3. **Folder >500MB composed of files <100MB**:
   - `many_small_files`: contains six `90M` files (`540M` total, each file `<100M`).
   - Expected: `many_small_files` IS in `>500MB` folder output; none of its `90M` files appear in `>100MB` file output.
4. **Paths with spaces & >100MB file detection**:
   - `folder with spaces/big file 150M.bin` (`150M` file): appears in `>100MB` file output, while `many_small_files/part1.bin` (`90M`) does not.
5. **Excluded mount directory skipped by both `du` and `find`**:
   - Simulate an excluded mount path `$TEST_ROOT/fake_external_mount` containing a `600M` file; verify neither the folder nor the file inside `fake_external_mount` is reported.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/test_scan_big_files.sh`
Expected: FAIL (`scan_big_folders` / `scan_big_files` not implemented yet)

- [ ] **Step 3: Implement `scan_big_folders`, `scan_big_files`, and `main` in `scan_big_files.sh`**

Key algorithm in `scan_big_folders` (`awk` processing `du -BM` output `size_mb\tpath`):
```awk
# Filter candidate folders with size_mb > min_mb
# Sort candidates by slash depth descending (deepest paths first)
# For each candidate D (from deepest to shallowest):
#   covered = 0
#   For each already-processed direct or indirect descendant S in topmost_selected:
#     if S starts with (D == "/" ? "/" : D "/") and is not covered by an intermediate selected ancestor:
#       covered += size[S]
#   if (size[D] - covered) > min_mb:
#     selected[D] = 1
# Emit selected folders sorted by size[D] descending, formatted as MB or GB (e.g. >=1024M -> %.2fG, else %dM)
```

Key implementation in `scan_big_files`:
- Build `find` prune array for all excluded paths under `target_dir`.
- Run `find "$target_dir" \( ... -prune \) -o -type f -size +"${FILE_MIN_MB}"M -printf "%s\t%p\n" 2>/dev/null`.
- Sort numerically descending (`sort -rn -k1,1`) and format byte sizes in `awk` (`>=1073741824` -> `%.2fG`, else `%.1fM` / `%dM`).

- [ ] **Step 4: Run test suite to verify all tests pass**

Run: `bash tests/test_scan_big_files.sh`
Expected: PASS (all unit and integration tests pass)

- [ ] **Step 5: Commit implementation and tests**

```bash
git add scan_big_files.sh tests/test_scan_big_files.sh docs/superpowers/
git commit -m "feat: implement big folder and file scanner with dynamic mount exclusion"
```

---

### Task 3: Live System Verification and Documentation

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `scan_big_files.sh`
- Produces: `README.md` usage guide and verified real-system execution output.

- [ ] **Step 1: Run `scan_big_files.sh` on real system paths to verify live behavior**

Run: `./scan_big_files.sh /home/mickey` and verify `df` exclusion output on `/`
Expected: Prints detected external mounts (`/mnt/jfs`, `/mnt/cloudflare_R2`) and virtual filesystems (`/proc`, `/sys`, `/dev`, `/run`), and outputs sorted folders `>500MB` and files `>100MB`.

- [ ] **Step 2: Write `README.md` documenting features, usage, and parameters**

Document in `README.md`:
- Overview of dynamic mount exclusion (`df -PT` + `lsblk`), parent-child folder deduplication, and `>500MB` / `>100MB` scanning.
- Usage examples (`./scan_big_files.sh`, `sudo ./scan_big_files.sh /`, `./scan_big_files.sh /var`).
- Running tests (`bash tests/test_scan_big_files.sh`).

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: add README for scan_big_files.sh"
```
