# X-Plane 12 插件测试覆盖率检查指南

本文档详细说明了如何使用 `gcov` 工具对 `RadioPlugin` 及其测试套件进行代码覆盖率分析。遵循此流程，开发者可以量化测试的完备性，并识别未被测试覆盖的代码路径。

---

## 1. 准备工具 (Prerequisites)

确保您的环境中已安装以下工具：
*   **g++** (GCC 编译器)
*   **gcov** (通常随 GCC 一起安装)

---

## 2. 检查步骤 (Step-by-Step Instructions)

### 步骤 1：插桩编译 (Compile with Instrumentation)
在编译测试程序时，需要添加 `-fprofile-arcs` 和 `-ftest-coverage` 标志。这会告诉编译器在生成的可执行文件中嵌入计数器代码，并生成用于分析的 `.gcno` 文件。

**执行指令：**
```bash
g++ -fprofile-arcs -ftest-coverage \
    -Itest -Itest/XPLM -IRadioPlugin/src \
    test/TestMain.cpp -o test/run_tests_cov
```

### 步骤 2：运行测试 (Execute Tests)
运行生成的可执行文件。程序在运行过程中会记录每一行代码的执行次数，并在退出时生成 `.gcda` 数据文件。

**执行指令：**
```bash
./test/run_tests_cov
```

### 步骤 3：生成覆盖率报告 (Generate Report)
使用 `gcov` 处理生成的数据。建议使用 `-r` (仅显示相对路径) 和 `-f` (显示每个函数的汇总) 参数。

**执行指令：**
```bash
# 生成并显示核心源码文件的摘要
gcov -r -f test/run_tests_cov-TestMain.gcda | grep -E "File '(RadioPlugin/src/AudioCapture|RadioPlugin/src/AudioPlayback|RadioPlugin/src/RadioPlugin)" -A 1
```

---

## 3. 报告解读 (Interpreting the Report)

### 3.1 摘要信息
`gcov` 会输出类似以下的内容：
```text
File 'RadioPlugin/src/RadioPlugin.cpp'
Lines executed:94.59% of 37
```
这表示该文件中有 94.59% 的可执行行已被至少运行过一次。

### 3.2 详细报告 (.gcov 文件)
执行上述 `gcov` 命令后，目录中会生成 `.gcov` 结尾的文本文件（如 `RadioPlugin.cpp.gcov`）。打开该文件可以查看逐行分析：

*   **数字 (如 `5:`)**：表示该行代码被执行了 5 次。
*   **`-:`**：表示该行不可执行（如注释、空行、大括号）。
*   **`#####`**：表示该行**从未被执行过**。这是优化的重点。

---

## 4. 优化覆盖率 (Improving Coverage)

如果您在 `.gcov` 文件中发现了大量 `#####` 标记：
1.  **识别逻辑**：查看这些行属于哪个 `if` 分支或错误处理逻辑。
2.  **构造用例**：在 `test/TestMain.cpp` 中编写能够触发该特定条件的测试函数。
3.  **循环迭代**：重新执行步骤 1-3，直到覆盖率达到预期目标（建议核心逻辑 > 90%）。

---

## 5. 注意事项 (Important Notes)

*   **清理残留**：每次大幅修改测试代码后，建议删除旧的 `.gcda` 文件，以确保统计数据的准确性。
*   **模拟依赖**：由于测试是在脱离 X-Plane 的环境下运行的，所有被覆盖的代码路径都依赖于 `test/XPLMMock.h` 中 Mock 行为的真实度。
