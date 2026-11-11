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
                if ((fs !~ /^\/dev\// && fstype != "zfs" && fstype != "bcachefs") || fs ~ /^\/dev\/loop/) {
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
                $1 ~ /^\// && NF >= 3 {
                    is_removable = 0
                    if ($(NF-1) ~ /^[01]$/) {
                        rm = $(NF-1)
                        hotplug = $NF
                        mp_end = NF - 2
                        if (rm == "1" || hotplug == "1") {
                            is_removable = 1
                        }
                    } else if (NF >= 4) {
                        rm = $(NF-2)
                        tran = $(NF-1)
                        hotplug = $NF
                        mp_end = NF - 3
                        if (rm == "1" || hotplug == "1" || tolower(tran) == "usb") {
                            is_removable = 1
                        }
                    } else {
                        next
                    }
                    mp = $1
                    for (i = 2; i <= mp_end; i++) {
                        mp = mp " " $i
                    }
                    gsub(/\\x20/, " ", mp)
                    sub(/\/+$/, "", mp)
                    if (mp == "" || mp == "/") next
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

scan_big_folders() {
    local target_dir="$1"
    local excludes_list="${2:-}"
    local -a du_excludes=()

    while IFS= read -r ex; do
        [[ -n "$ex" ]] && du_excludes+=("--exclude=$ex")
    done <<< "$excludes_list"

    { du -BM "${du_excludes[@]}" "$target_dir" 2>/dev/null || true; } | awk -v min_mb="$FOLDER_MIN_MB" '
        {
            sz_str = $1
            sub(/M$/, "", sz_str)
            sz = sz_str + 0
            if (sz <= min_mb) next

            tab_idx = index($0, "\t")
            if (tab_idx == 0) next
            p = substr($0, tab_idx + 1)
            if (p != "/") sub(/\/+$/, "", p)

            n++
            paths[n] = p
            size_mb[p] = sz
        }
        END {
            # Sort candidate paths by length descending (deepest paths first)
            for (i = 2; i <= n; i++) {
                key_p = paths[i]
                key_len = length(key_p)
                j = i - 1
                while (j >= 1 && length(paths[j]) < key_len) {
                    paths[j + 1] = paths[j]
                    j--
                }
                paths[j + 1] = key_p
            }

            # Bottom-up deduplication of ancestor folders
            for (i = 1; i <= n; i++) {
                d = paths[i]
                prefix = (d == "/") ? "/" : d "/"
                plen = length(prefix)
                covered = 0

                for (s in active_sel) {
                    if (s != d && substr(s, 1, plen) == prefix) {
                        covered += size_mb[s]
                    }
                }

                if ((size_mb[d] - covered) > min_mb) {
                    selected[d] = 1
                    for (s in active_sel) {
                        if (s != d && substr(s, 1, plen) == prefix) {
                            delete active_sel[s]
                        }
                    }
                    active_sel[d] = 1
                }
            }

            for (d in selected) {
                printf "%d\t%s\n", size_mb[d], d
            }
        }
    ' | sort -rn -k1,1 | awk '
        {
            sz = $1 + 0
            tab_idx = index($0, "\t")
            p = substr($0, tab_idx + 1)
            if (sz >= 1024) {
                human = sprintf("%.2fG", sz / 1024.0)
            } else {
                human = sprintf("%dM", sz)
            }
            printf "%-10s\t%s\n", human, p
        }
    '
}

scan_big_files() {
    local target_dir="$1"
    local excludes_list="${2:-}"
    local -a find_args=("$target_dir")
    local -a prune_expr=()

    while IFS= read -r ex; do
        if [[ -n "$ex" ]]; then
            if [[ ${#prune_expr[@]} -gt 0 ]]; then
                prune_expr+=("-o")
            fi
            prune_expr+=("-path" "$ex")
        fi
    done <<< "$excludes_list"

    if [[ ${#prune_expr[@]} -gt 0 ]]; then
        find_args+=("(" "${prune_expr[@]}" ")" "-prune" "-o")
    fi
    find_args+=("-type" "f" "-size" "+${FILE_MIN_MB}M" "-printf" "%s\t%p\n")

    { find "${find_args[@]}" 2>/dev/null || true; } | sort -rn -k1,1 | awk '
        {
            bytes = $1 + 0
            tab_idx = index($0, "\t")
            if (tab_idx == 0) next
            p = substr($0, tab_idx + 1)
            if (bytes >= 1073741824) {
                human = sprintf("%.2fG", bytes / 1073741824.0)
            } else {
                human = sprintf("%.1fM", bytes / 1048576.0)
            }
            printf "%-10s\t%s\n", human, p
        }
    '
}

main() {
    local raw_target="${1:-/}"
    if [[ ! -d "$raw_target" ]]; then
        echo "错误: 目标目录不存在或不是有效目录: $raw_target" >&2
        return 1
    fi

    local target_dir
    target_dir="$(cd "$raw_target" && pwd -P)"
    local excludes_list
    excludes_list="$(detect_excluded_mounts "$target_dir")"

    echo "============================================================"
    echo " 磁盘大文件夹 (> ${FOLDER_MIN_MB}MB) 与大文件 (> ${FILE_MIN_MB}MB) 扫描报告"
    echo "============================================================"
    echo "扫描目标路径: $target_dir"
    if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
        echo "权限提示: 当前以非 root 用户运行，无权限访问的系统目录将被自动跳过。"
    fi

    if [[ -n "$excludes_list" ]]; then
        local excludes_inline
        excludes_inline="$(printf '%s\n' "$excludes_list" | awk '{printf "%s%s", (NR>1 ? ", " : ""), $0} END {print ""}')"
        echo "已自动排除虚拟文件系统与外部存储挂载点: $excludes_inline"
    else
        echo "已自动排除虚拟文件系统与外部存储挂载点: (无)"
    fi
    echo "------------------------------------------------------------"

    echo ""
    echo "[1/2] 大于 ${FOLDER_MIN_MB}MB 的文件夹 (按体积降序，已过滤仅因包含大子目录而超标的父目录):"
    echo "体积      	路径"
    local folder_results
    folder_results="$(scan_big_folders "$target_dir" "$excludes_list")"
    if [[ -n "$folder_results" ]]; then
        printf '%s\n' "$folder_results"
    else
        echo "(未发现大于 ${FOLDER_MIN_MB}MB 的文件夹)"
    fi

    echo ""
    echo "[2/2] 大于 ${FILE_MIN_MB}MB 的文件 (按体积降序):"
    echo "体积      	路径"
    local file_results
    file_results="$(scan_big_files "$target_dir" "$excludes_list")"
    if [[ -n "$file_results" ]]; then
        printf '%s\n' "$file_results"
    else
        echo "(未发现大于 ${FILE_MIN_MB}MB 的文件)"
    fi
    echo "============================================================"
}

if [[ "${1:-}" == "--source-only" ]]; then
    return 0 2>/dev/null || exit 0
fi

main "$@"
