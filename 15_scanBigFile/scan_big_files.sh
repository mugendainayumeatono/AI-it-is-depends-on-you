#!/usr/bin/env bash
set -euo pipefail

DF_CMD="${DF_CMD:-df}"
LSBLK_CMD="${LSBLK_CMD:-lsblk}"
FOLDER_MIN_MB="${FOLDER_MIN_MB:-500}"
FILE_MIN_MB="${FILE_MIN_MB:-100}"

normalize_path() {
    local p="$1"
    if [[ "$p" != "/" ]]; then
        p="${p%/}"
    fi
    printf '%s\n' "$p"
}

detect_excluded_mounts() {
    local target_dir
    target_dir="$(normalize_path "${1:-/}")"

    {
        # Always include standard kernel virtual filesystems
        printf '/proc\n/sys\n/dev\n/run\n'

        # Parse df -PT to dynamically detect virtual, FUSE, network, or non-local mounts
        "$DF_CMD" -PT 2>/dev/null | awk '
            NR > 1 {
                fs = $1
                fstype = $2
                if (match($0, /[[:space:]]([0-9]+%|-)[[:space:]]+/)) {
                    mp = substr($0, RSTART + RLENGTH)
                } else {
                    mp = $7
                    for (i = 8; i <= NF; i++) mp = mp " " $i
                }
                sub(/\/+$/, "", mp)
                if (mp == "") mp = "/"

                is_external_or_virt = 0
                if (fs !~ /^\/dev\// || fs ~ /^\/dev\/loop/) {
                    is_external_or_virt = 1
                }
                if (fstype ~ /^(fuse(\..*)?|nfs[0-9]*|cifs|smb[0-9]*|smbfs|tmpfs|devtmpfs|squashfs|overlay|iso9660|udf|autofs|ceph|glusterfs|9p|davfs|sshfs|proc|sysfs|cgroup[0-9]*|debugfs|tracefs|securityfs|pstore|efivarfs|mqueue|hugetlbfs|binfmt_misc|configfs|fusectl|ramfs|vboxsf|vmhgfs-fuse)$/) {
                    is_external_or_virt = 1
                }
                if (is_external_or_virt && mp != "/") {
                    print mp
                }
            }
        '

        # Parse lsblk to detect removable / USB block devices
        if command -v "$LSBLK_CMD" >/dev/null 2>&1 || [[ -x "$LSBLK_CMD" ]]; then
            "$LSBLK_CMD" -nrpo MOUNTPOINT,RM,TRAN,HOTPLUG 2>/dev/null | awk '
                $1 ~ /^\// {
                    mp = $1
                    sub(/\/+$/, "", mp)
                    if (mp == "" || mp == "/") next
                    is_removable = 0
                    if (NF >= 4) {
                        rm = $(NF-2)
                        tran = $(NF-1)
                        hotplug = $NF
                        if (rm == "1" || hotplug == "1" || tolower(tran) == "usb") {
                            is_removable = 1
                        }
                    } else if (NF == 3) {
                        if ($2 == "1" || $3 == "1") {
                            is_removable = 1
                        }
                    }
                    if (is_removable) {
                        print mp
                    }
                }
            '
        fi
    } | awk -v target="$target_dir" '
        NF > 0 {
            mp = $0
            if (mp == "/" || mp == target) next
            # Do not exclude an ancestor of target_dir
            if (index(target "/", mp "/") == 1) next
            if (!seen[mp]++) print mp
        }
    ' | sort -u
}

main() {
    local target_dir="${1:-/}"
    if [[ ! -d "$target_dir" ]]; then
        echo "错误: 目标目录不存在或不是有效目录: $target_dir" >&2
        return 1
    fi
}

if [[ "${1:-}" == "--source-only" ]]; then
    return 0 2>/dev/null || exit 0
fi

main "$@"
