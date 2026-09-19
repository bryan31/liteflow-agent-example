#!/usr/bin/env python3
"""
股票价格查询工具
支持单只/多只股票批量查询
首选腾讯财经接口，备用东方财富

用法:
    python stock_query.py <代码1> [代码2] [代码3...]
    python stock_query.py 000688
    python stock_query.py 000688 600519 300750
"""

import requests
import sys
import time
import subprocess
import io
from concurrent.futures import ThreadPoolExecutor, as_completed


def get_prefix(code):
    """根据代码前缀判断交易所"""
    if code.startswith('6'):
        return 'sh'
    elif code.startswith(('0', '3')):
        return 'sz'
    elif code.startswith('8') or code.startswith('4'):
        return 'bj'
    else:
        return 'sz'


def parse_tencent_response(text):
    """解析腾讯财经响应"""
    try:
        data = text.split('~')
        if len(data) < 45:
            return None

        return {
            'name': data[1],
            'code': data[2],
            'price': float(data[3]),
            'yest_close': float(data[4]),
            'open': float(data[5]),
            'high': float(data[33]),
            'low': data[34],
            'volume': data[36],  # 成交量（手）
            'amount': data[37],  # 成交金额（万）
            'change': float(data[31]),       # 涨跌额
            'change_pct': float(data[32]),   # 涨跌幅%
            'source': '腾讯',
        }
    except Exception:
        return None


def query_tencent(code):
    """通过腾讯财经查询"""
    prefix = get_prefix(code)
    url = f"http://qt.gtimg.cn/q={prefix}{code}"
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            result = parse_tencent_response(resp.text)
            if result:
                result['raw_code'] = code
                return result
    except Exception:
        pass
    return None


def query_eastmoney(code):
    """通过东方财富查询"""
    secid = f"1.{code}" if code.startswith('6') else f"0.{code}"
    fields = "f43,f57,f58,f169,f170,f46,f44,f51,f168,f47,f164,f116,f60,f45,f52,f50,f48,f167,f117,f71,f161,f49,f530,f135,f136,f137,f138,f139,f141,f142,f144,f145,f147,f148,f140,f143,f146,f149,f55,f62,f162,f92,f173,f104,f105,f84,f85,f83,f76,f77,f78,f79,f80,f81,f82,f86,f88,f89,f90,f91,f87,f64,f65,f66,f69,f70,f71,f72,f73,f74,f75,f113,f114,f115,f119,f120,f121,f122,f200,f201,f202"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields={fields}"
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data and data.get("data"):
                d = data["data"]
                price = d["f43"] / 100.0 if d.get("f43") else 0
                yest = d["f60"] / 100.0 if d.get("f60") else 0
                change = price - yest
                change_pct = (change / yest * 100) if yest else 0
                return {
                    'name': d.get("f58", code),
                    'code': d.get("f57", code),
                    'price': price,
                    'yest_close': yest,
                    'open': d["f46"] / 100.0 if d.get("f46") else 0,
                    'high': d["f44"] / 100.0 if d.get("f44") else 0,
                    'low': d["f45"] / 100.0 if d.get("f45") else 0,
                    'volume': str(d.get("f47", 0)),
                    'amount': str(d.get("f48", 0)),
                    'change': round(change, 2),
                    'change_pct': round(change_pct, 2),
                    'source': '东方财富',
                    'raw_code': code,
                }
    except Exception:
        pass
    return None


def query_stock(code):
    """查询单只股票，腾讯优先，东方财富备用"""
    # 腾讯优先
    result = query_tencent(code)
    if result:
        return result

    # 腾讯失败，尝试东方财富
    result = query_eastmoney(code)
    if result:
        return result

    return {'raw_code': code, 'error': '无法获取数据'}


def format_number(n):
    """格式化数字，添加千分位"""
    if n is None or n == '':
        return '-'
    try:
        num = float(n)
        if num >= 100000000:
            return f"{num/100000000:.2f}亿"
        elif num >= 10000:
            return f"{num/10000:.2f}万"
        else:
            return f"{num:,.0f}"
    except:
        return str(n)


def print_single(result):
    """打印单只股票详情"""
    if 'error' in result:
        print(f"❌ [{result['raw_code']}] {result['error']}")
        return

    name = result.get('name', '-')
    code = result.get('code', result['raw_code'])
    price = result.get('price', 0)
    yest = result.get('yest_close', 0)
    change = result.get('change', 0)
    change_pct = result.get('change_pct', 0)
    high = result.get('high', 0)
    low_val = result.get('low', 0)
    volume = result.get('volume', '-')
    amount = result.get('amount', '-')
    source = result.get('source', '-')
    open_price = result.get('open', 0)

    # 涨跌颜色符号
    if change > 0:
        color = "🔴"
        sign = "+"
    elif change < 0:
        color = "🟢"
        sign = ""
    else:
        color = "⚪"
        sign = ""

    print(f"\n{'='*60}")
    print(f"{color} {name} ({code})")
    print(f"{'='*60}")
    print(f"  💰 当前价格:  ¥{price:.2f}")
    print(f"  📊 涨跌额:    {sign}{change:.2f}")
    print(f"  📈 涨跌幅:    {sign}{change_pct:.2f}%")
    print(f"  📉 昨收:      ¥{yest:.2f}")
    print(f"  🌅 今开:      ¥{open_price:.2f}")
    print(f"  ⬆️  最高:      ¥{high:.2f}")
    print(f"  ⬇️  最低:      ¥{float(low_val):.2f}")
    print(f"  📦 成交量:    {format_number(volume)}手")
    print(f"{'='*60}")


def print_table(results):
    """打印多只股票表格"""
    print(f"\n{'='*100}")
    print(f"{'名称':<12} {'代码':<10} {'当前价':>10} {'涨跌额':>10} {'涨跌幅':>10} {'昨收':>10} {'最高':>10} {'最低':>10}")
    print(f"{'-'*100}")

    for r in results:
        if 'error' in r:
            print(f"{'❌ 错误':<12} {r['raw_code']:<10} {'无法获取数据':<30}")
            continue

        name = r.get('name', '-')[:10]
        code = r.get('code', r['raw_code'])
        price = r.get('price', 0)
        change = r.get('change', 0)
        change_pct = r.get('change_pct', 0)
        yest = r.get('yest_close', 0)
        high = r.get('high', 0)
        low_val = r.get('low', 0)

        if change > 0:
            sign = "+"
        else:
            sign = ""

        print(f"{name:<12} {code:<10} ¥{price:>8.2f} {sign}{change:>8.2f} {sign}{change_pct:>7.2f}% ¥{yest:>8.2f} ¥{high:>8.2f} ¥{float(low_val):>8.2f}")

    print(f"{'='*100}")
    print(f"\n查询时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"数据源: 腾讯财经优先，东方财富备用")


def get_target_info():
    """动态获取目标用户和渠道"""
    import os
    
    # 1. 从环境变量获取
    target = os.environ.get('STOCK_TARGET')
    channel = os.environ.get('STOCK_CHANNEL', 'feishu')
    
    # 2. 从配置文件获取
    config_file = os.path.expanduser('~/.stock_push_config')
    if not target and os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('target='):
                        target = line.split('=', 1)[1].strip()
                    elif line.startswith('channel='):
                        channel = line.split('=', 1)[1].strip()
        except:
            pass
    
    # 3. 从命令行参数获取 (--target 和 --channel)
    # 这部分在main函数中处理，这里只返回默认值或环境变量值
    
    return target, channel


def send_message(message, target=None, channel=None):
    """将消息推送到指定渠道（后台异步执行，避免阻塞）"""
    try:
        import os
        
        # 如果没有传入参数，动态获取
        if not target or not channel:
            t, c = get_target_info()
            target = target or t
            channel = channel or c
        
        # 如果还是没有target，就不推送，只输出到控制台
        if not target:
            print("⚠️  未配置目标用户，跳过推送")
            return False
        
        # 将消息写入临时文件
        msg_file = f'/tmp/stock_message_{os.getpid()}.txt'
        with open(msg_file, 'w') as f:
            f.write(message)
        
        # 创建临时脚本，后台执行推送
        script = f'''#!/bin/bash
sleep 1
openclaw message send --channel {channel} --target {target} --message "$(cat {msg_file})"
rm -f {msg_file} $0
'''
        import tempfile
        script_file = tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False)
        script_file.write(script)
        script_file.close()
        os.chmod(script_file.name, 0o755)
        
        # 后台执行
        subprocess.Popen(
            ['bash', script_file.name], 
            stdout=subprocess.DEVNULL, 
            stderr=subprocess.DEVNULL
        )
        return True
    except Exception as e:
        print(f"推送失败: {e}", file=sys.stderr)
        return False


def main():
    # 检查帮助请求
    if len(sys.argv) < 2 or '-h' in sys.argv or '--help' in sys.argv:
        print("用法: python stock_query.py [选项] <代码1> [代码2] [代码3...]")
        print("选项:")
        print("  --target <用户ID>    指定推送目标用户ID")
        print("  --channel <渠道>     指定推送渠道 (feishu/wecom等)")
        print("  --no-push            仅输出不推送")
        print("  -h, --help           显示此帮助信息")
        print("")
        print("环境变量:")
        print("  STOCK_TARGET         默认推送目标用户ID")
        print("  STOCK_CHANNEL        默认推送渠道")
        print("")
        print("配置文件: ~/.stock_push_config")
        print("  target=<用户ID>      默认推送目标")
        print("  channel=<渠道>       默认推送渠道")
        print("")
        print("示例: python stock_query.py 000688")
        print("      python stock_query.py --target ou_xxx --channel feishu 000688")
        print("      python stock_query.py --no-push 000688 600519")
        sys.exit(0 if '-h' in sys.argv or '--help' in sys.argv else 1)

    # 解析参数
    codes = []
    target = None
    channel = None
    no_push = False  # 是否禁用推送
    
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == '--target' and i + 1 < len(sys.argv):
            target = sys.argv[i + 1]
            i += 2
        elif arg == '--channel' and i + 1 < len(sys.argv):
            channel = sys.argv[i + 1]
            i += 2
        elif arg == '--no-push':
            no_push = True
            i += 1
        elif arg.startswith('--target='):
            target = arg.split('=', 1)[1]
            i += 1
        elif arg.startswith('--channel='):
            channel = arg.split('=', 1)[1]
            i += 1
        else:
            codes.append(arg)
            i += 1

    if not codes:
        print("错误: 请指定至少一个股票代码")
        print("使用 -h 或 --help 查看帮助")
        sys.exit(1)

    # 捕获输出到字符串，用于推送
    output_capture = io.StringIO()
    original_stdout = sys.stdout

    # 先输出到控制台，同时捕获内容
    print(f"📊 正在查询 {len(codes)} 只股票...")
    output_capture.write(f"📊 正在查询 {len(codes)} 只股票...\n")

    if len(codes) == 1:
        # 单只查询，详细输出
        result = query_stock(codes[0])
        # 同时输出到控制台和捕获
        sys.stdout = output_capture
        print_single(result)
        sys.stdout = original_stdout
        # 再次打印到控制台
        print_single(result)
    else:
        # 多只查询，并发 + 表格输出
        results = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(query_stock, code): code for code in codes}
            for future in as_completed(futures):
                result = future.result()
                results.append(result)

        # 按传入顺序排序
        order_map = {code: i for i, code in enumerate(codes)}
        results.sort(key=lambda x: order_map.get(x.get('raw_code', ''), 999))

        # 同时输出到控制台和捕获
        sys.stdout = output_capture
        print_table(results)
        sys.stdout = original_stdout
        # 再次打印到控制台
        print_table(results)

    # 获取捕获的输出，添加时间戳后推送
    captured_output = output_capture.getvalue()
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    full_message = f"⏰ 定时报告 - {timestamp}\n" + captured_output

    # 推送到指定渠道（除非指定了--no-push）
    if not no_push:
        print(f"正在推送到{channel or '默认渠道'}...", end=' ')
        if send_message(full_message, target, channel):
            print("✅ 推送成功")
        else:
            print("❌ 推送失败")
    else:
        print("（已禁用推送）")


if __name__ == "__main__":
    main()
