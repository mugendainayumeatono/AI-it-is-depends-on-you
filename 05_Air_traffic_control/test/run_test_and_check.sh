#!/bin/bash

# X-Plane 12 RadioPlugin 测试覆盖率自动检查脚本

# 获取脚本所在目录的绝对路径，并推导出项目根目录
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.."; pwd)

SRC_DIR="$ROOT_DIR/RadioPlugin/src"
TEST_DIR="$ROOT_DIR/test"
BUILD_DIR="$TEST_DIR/build_cov"
EXECUTABLE="$BUILD_DIR/run_tests_cov"

echo "=========================================="
echo "   X-Plane 12 插件测试覆盖率自动检查程序   "
echo "=========================================="

# 1. 环境准备
cd "$ROOT_DIR"
mkdir -p "$BUILD_DIR"

# 2. 清理旧的数据
echo "[1/4] 正在清理旧的数据..."
rm -f "$TEST_DIR"/*.gcda "$TEST_DIR"/*.gcno "$BUILD_DIR"/*.gcda "$BUILD_DIR"/*.gcno "$BUILD_DIR"/*.gcov *.gcov

# 3. 插桩编译
echo "[2/4] 正在进行插桩编译 (Instrumentation)..."
g++ -fprofile-arcs -ftest-coverage \
    -I"$TEST_DIR" -I"$TEST_DIR/XPLM" -I"$SRC_DIR" \
    "$TEST_DIR/TestMain.cpp" -o "$EXECUTABLE"

if [ $? -ne 0 ]; then
    echo "错误：编译失败，请检查编译环境。"
    exit 1
fi

# 4. 运行测试程序生成数据
echo "[3/4] 正在运行测试套件..."
# 必须在生成编译产物的目录下运行或指定路径，gcov 才能关联数据
cd "$BUILD_DIR"
./run_tests_cov > /dev/null

if [ $? -ne 0 ]; then
    echo "警告：某些测试用例未通过，覆盖率数据可能不完整。"
fi

# 5. 生成并显示摘要报告
echo "[4/4] 正在生成覆盖率分析报告..."
cd "$ROOT_DIR"
# 使用 gcov 分析编译产生的对象数据
gcov "$TEST_DIR/TestMain.cpp" -o "$BUILD_DIR/run_tests_cov-TestMain" > "$BUILD_DIR/gcov_summary.txt" 2>&1

echo ""
echo "---------------- 核心模块覆盖率摘要 ----------------"
# 过滤并格式化显示核心源文件的覆盖率
grep -E "(AudioCapture|AudioPlayback|RadioPlugin).cpp" -A 1 "$BUILD_DIR/gcov_summary.txt"
echo "----------------------------------------------------"

# 将所有生成的 .gcov 文件移动到 build_cov 文件夹
mv *.gcov "$BUILD_DIR/" 2>/dev/null

echo ""
echo "详细逐行报告已保存至：$BUILD_DIR"
echo "您可以通过查看该文件夹下的以下文件了解未覆盖的代码路径："
ls "$BUILD_DIR" | grep ".cpp.gcov"

echo ""
echo "检查完成！"
