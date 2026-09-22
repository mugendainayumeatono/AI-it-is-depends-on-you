#!/usr/bin/env python3
"""
PDF 权限限制解除工具 (PDF Permission Unlocker)
==============================================
用于解除 PDF 文件的所有者密码权限限制（如禁止复制、禁止打印、禁止批注等），
同时 100% 完整保留书签目录（TOC/Outlines）、内部超链接、页面结构和高清图像。

使用方法:
    uv run --with pikepdf python unlock_pdf.py [输入文件.pdf] [可选:输出文件.pdf]

示例:
    uv run --with pikepdf python unlock_pdf.py "B-737-7-8-900_FCOM_TBC_C_080125_V1V2_B8P-C.pdf"
"""

import sys
import os
import time

def unlock_pdf(input_path: str, output_path: str = None) -> str:
    try:
        import pikepdf
    except ImportError:
        print("[错误] 未找到 pikepdf 模块。请通过 uv 运行:")
        print(f"       uv run --with pikepdf python {sys.argv[0]} <pdf文件>")
        sys.exit(1)

    if not os.path.isfile(input_path):
        print(f"[错误] 文件未找到: {input_path}")
        sys.exit(1)

    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_unlocked{ext}"

    print(f"[1/3] 正在读取并分析: {os.path.basename(input_path)}")
    t0 = time.time()
    
    with pikepdf.open(input_path) as pdf:
        print(f"      - PDF 版本: {pdf.pdf_version}")
        print(f"      - 总页数: {len(pdf.pages)}")
        print(f"      - 是否存在加密/权限锁定: {pdf.is_encrypted}")
        
        if not pdf.is_encrypted:
            print("[提示] 该 PDF 未设置权限加密，无需解密。")
        
        print(f"[2/3] 正在解除权限限制并保存到: {os.path.basename(output_path)}")
        pdf.save(output_path)
        
    t1 = time.time()
    print(f"[3/3] 权限限制解除成功！耗时: {t1 - t0:.2f} 秒")
    print(f"      已解锁文件位置: {output_path}")
    print("      已解除限制: 允许复制文字、允许打印、允许添加批注与编辑。")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        default_file = "B-737-7-8-900_FCOM_TBC_C_080125_V1V2_B8P-C.pdf"
        if os.path.isfile(default_file):
            unlock_pdf(default_file)
        else:
            print("用法: uv run --with pikepdf python unlock_pdf.py <输入PDF路径> [输出PDF路径]")
    else:
        in_file = sys.argv[1]
        out_file = sys.argv[2] if len(sys.argv) > 2 else None
        unlock_pdf(in_file, out_file)
