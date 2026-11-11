# 系统大文件夹（>500MB）与大文件（>100MB）扫描脚本

`scan_big_files.sh` 是一个零外部依赖的 Linux 磁盘空间排查脚本，用于快速定位系统中所有 **大于 500MB 的文件夹** 和 **大于 100MB 的文件**。

## 核心特性

1. **动态识别并排除外部存储与虚拟文件系统（不硬编码 `/mnt`、`/media`）**
   - 自动解析 `df -PT` 的挂载源（`Filesystem`）与文件系统类型（`Type`），动态识别并排除非本地块设备挂载、FUSE 挂载（如 `fuse.juicefs`、`fuse.rclone`、`fuse.sshfs`）、网络存储（`nfs`、`cifs`、`smb`）及虚拟文件系统（`tmpfs`、`devtmpfs`、`squashfs`、`overlay` 等）。
   - 自动调用 `lsblk` 识别可移动设备与 USB 存储（`RM=1`、`HOTPLUG=1`、`TRAN=usb`）并排除其挂载点。
   - 兜底排除内核伪文件系统：`/proc`、`/sys`、`/dev`、`/run`。
2. **父子目录体积扣除去重（拒绝顶层目录刷屏）**
   - 自底向上计算每个候选大目录扣除其已超标（`>500MB`）子目录后的剩余有效体积：
     - 若父目录仅因为包含了 `>500MB` 的子目录而超标，则只展示最具体的子目录，不重复列出 `/home`、`/usr`、`/` 等祖先目录；
     - 若父目录扣除超标子目录后，自身其余文件/子目录合计仍 `>500MB`，则父子目录同时保留。
3. **高效剪枝与直观排序**
   - `find` 使用 `-prune` 直接跳过排除挂载点，不产生无效跨盘/远程 I/O。
   - 文件夹与文件结果均按体积**从大到小降序**排列，并格式化为易读的 `MB` / `GB` 单位。

## 使用方法

```bash
# 赋予执行权限
chmod +x scan_big_files.sh

# 1. 默认扫描整个系统根目录 /（推荐使用 sudo 以遍历所有受限系统目录）
sudo ./scan_big_files.sh

# 2. 普通用户直接运行（无权限的系统目录会自动静默跳过）
./scan_big_files.sh

# 3. 扫描指定目录
./scan_big_files.sh /home/mickey
./scan_big_files.sh /var
```

## 环境变量配置（可选）

可通过环境变量临时调整扫描阈值：

```bash
# 示例：搜索大于 1000MB 的文件夹和大于 200MB 的文件
FOLDER_MIN_MB=1000 FILE_MIN_MB=200 ./scan_big_files.sh /var
```

## 运行自动化测试

```bash
bash tests/test_scan_big_files.sh
```
