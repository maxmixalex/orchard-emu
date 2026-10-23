# HP39gs 完整 ROM 采集包：复用 hpclang 的 ROM Stream

[下载 hp39gs-rom-dump-v1.zip](../downloads/hp39gs-rom-dump-v1.zip) ·
[SHA-256](../downloads/hp39gs-rom-dump-v1.zip.sha256)

这个包一次启动即可采集完整 **1,048,576 字节（1 MiB）**。它直接复用此前
hpclang 的 `H39 ROM USB` 计算器程序，不再要求先运行 ARM 返回或 16 字节探针。
计算器侧的 aplet、ARM payload 和 Library 275 与用户提供的旧包逐字节一致；
接收器更新为每个 16 KiB 块读取两次、逐字节比较，再保存完整映像。

## 直接使用

包内提供 Windows x64 的 `hp39-rom-receiver.exe`，无须安装 Python、Go、hidapi
或额外 DLL。使用计算器原来的 USB 线。

1. 用已有的 Conn3x / HPGCC39 方式传入 `calculator/` 目录。选择 **HP 39/40**
   模式；aplet 是 `HPGCC000.000`，库是 `LIB275L.000`，目录文件是
   `HP39DIR.CUR` 与 `HP39DIR.000`。安装后 APLET 列表应显示 **H39 ROM USB**。
   如果此前已安装完全相同的 aplet 和 `ARMToolbox39` 库，可以直接使用原安装，
   不必重传。库必须是包内这个 39 专用版本，不能用 48/49 的同号库替代。
2. 关闭 Conn3x / HP Connectivity Kit，拔掉计算器 USB。接收器需要单独占用
   临时 HID 设备。保留平时的计算器数据备份，采集不更新或擦写 Flash。
3. 在解压目录打开 PowerShell，运行：

   ```powershell
   .\hp39-rom-receiver.exe -model hp39gs hp39gs-full.bin
   ```

   如果已知 VERSION 结果，可以加 `-rom-version "C2.22"`。这只是记录实际版本，
   不会修改固件，也不决定设备识别。
4. **保持 USB 未连接**，按 APLET，选 **H39 ROM USB**，按 START。
   START 只进入 aplet 页面；随后按 **ENTER 一次**，才会执行 ARM 采集程序。
5. 现在插入 USB。Windows 应识别临时 **HP39g+ ROM Stream** HID 设备。
   这个名字来自复用的原二进制，在 HP39gs 上也保持不变；无需为它更换 USB 驱动。
6. 接收器自动读完 64 个块，显示每块 `two reads equal`。等待
   **`Dump complete`**。之后拔掉 USB，程序才会清理临时映射、恢复原系统运行。
   返回后可按 HOME。将 `hp39gs-full.bin` 和 `hp39gs-full.bin.json` 一起交回。

接收器不会覆盖任何已有 `.bin` 或同名 `.json`；重复采集时使用新的输出文件名。
USB 断开是这个原程序的正常退出边界，接收器完成后不要继续等计算器自动返回。
如果中途接收失败，也拔掉 USB，让程序退出；失败结果不会作为完整镜像保存。

## 一次启动内的双读

原协议已具备块重传命令 `R`。新版接收器使用这个现有命令，要求：

- 顺序、偏移、块长度、32 位字节和、FNV-1a 全部正确；
- 第一份有效块保留后，再请求一次完整 NOR 读取；
- 第二份也通过校验，而且与第一份 **16,384 个字节全部相同**，才发送 ACK；
- 64 个块及最终 END 汇总全部通过、两个输出文件完成落盘后，才发送 FINISH。

每块校验失败最多重试三次。两份分别通过校验的读取若内容不同，立即报错，
不会用后续重读掩盖差异。丢包、错序、截断、异常长度和缺少检查点均有明确边界。

这是 **同一次启动中每块两次读取**，不是两次独立开机采集。JSON 使用
`independent_block_reads_equal` 和 `read_passes_per_block: 2` 描述这一事实。
如希望另做一次完整采集，可在退出后重启 aplet，并运行：

```powershell
.\hp39-rom-receiver.exe -model hp39gs -compare hp39gs-full.bin hp39gs-second.bin
```

第二次捕获还会与第一份完整 1 MiB 文件逐字节比较。正常任务只需交回第一轮产生的
完整 `.bin` 与 `.json`，不要求先做额外的短采样。

## 读取范围与支持边界

ARM payload 将虚拟 `0x0a000000..0x0a0fffff` 映射到 **物理 NOR
`0x00000000..0x000fffff`**，包含前 16 KiB 的 ARM boot 区。对应 section
descriptor 为 `0x00000c12`，关闭该别名的 cache/buffer。它还临时映射四个
S3C2410 外设区，以轮询方式进行 USB 传输。五个 L1 表项在进入前必须全为零；
退出时清零并清理对应 cache/TLB。payload 没有 NOR 编程或擦除命令。[1]

程序用 ARMToolbox39 分配的 4 KiB 私有 RAM 栈，不借用 stock OS 的小栈运行 C。
它会暂时接管 USB、屏蔽 SoC IRQ、调整 USB 所需的时钟和 GPIO，并按原有实现
保存/恢复相关平台状态；USB endpoint 状态在断线后清理，不声称恢复已经结束的
连接。操作限制与旧 hpclang 包相同。[1]

r17 已在原始 **HP39g+ stock OS** 内，通过正常 USB 文件传输安装原 aplet 和库，
按 START / ENTER 执行其 ARM 代码，并用新版 Go 接收器经模拟的真实 USB endpoint
接收完整双读结果：**1,048,576 个字节与该机原 NOR 完全相同**，共 37,634 个 HID
输入报告、64 块各读两次。FINISH、断线、HOME 后重新输入 `1+1`，显示结果 `2`。
没有修改客体 RAM 或跳过入口来安装/运行 payload。此项使用显式 GPF1 电缆检测
外部输入，并补齐厂家两份手册记载的 MAXP 地址布局；它是模拟器内的原系统执行
验证，Windows HID 驱动本身和物理 HP39gs 不包含在该结果中。

**目标 HP39gs 的真机运行仍待用户回传**。HP39g+ 的历史成功采集与本次原系统
验证不能代替 HP39gs 实机结果；支持范围限定到使用 39 专用 ARMToolbox39
的 HP39gs 原厂系统（作者已有资料的版本前提为 C2.22）。本包不要求升级固件。

JSON 中的 `model` 是使用者明确选择；HID 名称不会自动证明它是 39g+ 还是 39gs。
`physical_mapping_verified`、`boot_verified` 和 `catalog_admitted` 初始仍为 false，
它们由后续对返回镜像的独立分析和原厂启动结果确定，不能由收到 1 MiB 文件自动推导。

可公开的原始结果与工具身份见 [r17 完整读出记录](evidence/hp39-romstream-r17.json)。
ROM、安装后的 checkpoint 与原始回传字节不随代码或文档发布。

### r18 完整包重建与最终回放

r18 只使用分发 ZIP 内的源码及外部编译器，离线重新生成了整个包，结果逐字节
相同：**1,045,637 字节**，SHA-256 为
`eeebe4ac2e9abf537fb25ecda40e441f3da0f52f30f36f3ea6a85ac0a84d1300`。
计算器目录中的四个文件也分别与本次用户上传的旧 ROM Stream ZIP 比对一致。
接收器协议测试、包检查及 25 个负例、Linux/Windows Go vet 均已通过。

最终生产 WASM
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`
再次完成全部 64 块双遍读出，1 MiB 内容与原 NOR 完全一致；FINISH、拔线、
返回 HOME 后的 `1+1=2` 也通过并重新看图核对。此次读出回放复用了此前正常 USB
安装所得的 checkpoint，没有重新宣称安装是在这一回放中完成的。

精确输入、工具身份、完整包重建和最终原系统执行结果见
[r18 独立复核记录](evidence/hp39-romstream-revalidation-r18.json)。
这仍不替代 HP39gs 真机运行或 Windows 原生 HID 驱动验收。

## 来源、重建与许可证

| 项目 | 身份 |
| --- | --- |
| hpclang 源码 | `e240c58c2e9dd3ac4d18002ed9a93d2c7cc67900` |
| ARM payload | 6,376 字节，SHA-256 `9baa02a66891d27ec771ce69c43f737fa322a6c3bc1d63402981a02ff90851f4` |
| HPGCC000.000 | 7,373 字节，SHA-256 `3669fb2c2ae1f755bd542c8373a469d49165f2769affdce5435e649010c62455` |
| LIB275L.000 | 1,489 字节，SHA-256 `88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1` |
| HP-GCC39 SDK | `7fa1503912338ea0fdf1d39eb584770f4d121cd2` |
| 原 ARM 编译器 | Arm Toolchain for Embedded 22.1.0 |

包内有全部对应的计算器侧源码、原 applet 模板/库源码、接收器源码、锁定的输入
hash、构建工具和许可证。hpclang 的原创 ARM/接收器代码及 Orchard 修改保留 MIT；
结合 HP-GCC39 模板的计算器 aplet 与 Library 275 按 GPLv2+ 分发，并提供完整对应源。
第三方计算器侧代码不进入模拟器 C/WASM 核心。包内没有 HP ROM、bootloader 或用户镜像。

解压后，在已准备 ATfE 22.1.0、HPTools 3.0.8（作者 64 位补丁）及 Go 1.22.x
的开发环境中，可完全离线重新生成包：

```sh
python3 tools/package-hp39-romstream.py build \
  --atfe /path/to/atfe --hptools /path/to/hptools/bin \
  /new/hp39gs-rom-dump-v1.zip
python3 tools/package-hp39-romstream.py verify /new/hp39gs-rom-dump-v1.zip
```

重建强制核对 ARM payload、最终 aplet 与库的固定 hash。接收器随 Go 补丁版本
可能具有不同 PE hash；包清单记录实际编译器与产物身份，不把跨编译器版本的二进制
差异当成计算器载荷差异。

### 一级资料

1. [hpclang 固定源码：完整 streamer 与原使用说明](https://github.com/maxmixalex/hpclang/tree/e240c58c2e9dd3ac4d18002ed9a93d2c7cc67900/research/hp39gplus)，包括 `rom-stream-entry.S`、`rom-stream.c`、`rom-stream-wrap.py` 和原 Windows receiver。上传包的 BUILD_INFO 指向同一 commit。
2. [HP-GCC39 固定 SDK 源码](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/HP39-Aplet)，包含原 applet skeleton、hp2aplet 和 39 专用 LIB275。
3. [Arm 官方 ATfE 22.1.0 发布](https://github.com/arm/arm-toolchain/releases/tag/release-22.1.0-ATfE)。Linux x86_64 编译器包 SHA-256：`e2e9e637bba097ba6e4bae6982883fe705ffd7e8c3a7dc876964835ef1c7a724`。
4. [HPTools 3.0.8 源包](https://www.hpcalc.org/hp48/pc/programming/hptools-src-3.0.8.tar.gz)及 [Paul Onions 64 位构建补丁](https://pdo.github.io/hptools/hptools-pdo-20190426.patch)。工具本身为外部构建依赖，不随本包分发。
