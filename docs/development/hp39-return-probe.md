# HP39gs ARM 入口与返回探针

下载：[hp39gs-arm-return-v1.zip](../downloads/hp39gs-arm-return-v1.zip)。

这份包用于你手上的 **HP39gs**：启动一个很小的 aplet，进入 ARM 后立即返回，
成功返回后由原厂系统显示 **`ARM RETURN OK`**。它是完整 Flash 读取程序的前置
探针，**目前不读取 Flash**。包内已带可传输的程序与所需的 39 专用库，不需要
你安装编译器。

**验收范围：已从原始源码重建配套库并与作者发布版逐字节一致；aplet 的目录链、
入口边界、ARM 封装和唯一指令经过独立检查。尚未在 HP39gs 真机或原厂系统中
安装并运行本探针。** 因此请先完成下面的版本/现有库检查；不能把静态验证当作
已经取得全量 Flash 或已让 Orchard 支持该机型。

## 1. 先核对机器

1. 在原版 HOME 输入 `VERSION`，记录完整结果。此包只针对 **HP39gs、C2.22
   或更新原厂 ROM**；这个下限来自原作者程序的兼容性说明，不是本探针的真机
   通过记录。若版本较旧、型号不同或显示不清，先停在版本查看这一步，不为此
   升级系统。
2. 在 **SHIFT → MEMORY → Libraries → SHOW** 查看是否已有 Library 275、
   `ARMToolbox39` 或 `ARMToolbox 39 1.0`。记录列表，保留正在使用的程序和数据。
   若已有同号库，不覆盖它；把其名称/来源与版本一起提供，先核对是否为同一版本。

查看路径、版本依据和第三方库身份详见
[HP39 原生入口先决条件](hp39-native-prerequisites.md)。包内的 `lib275.sys` 为
**39 专用库**，不能用 48/49 系列的同号库替代。

## 2. 传入程序

解压 ZIP。在现有可正常连接这台计算器的 **conn3x** 中使用 **HP 39/40**
传输方式。若第一步确认没有 Library 275，依次发送：

| 文件 | 用途 |
| --- | --- |
| `lib275.sys` | 39 专用 ARM 入口库，1,489 字节 |
| `ORCHRET.000` | `ORCHARD RET` aplet，815 字节 |

HP 39/40 模式不会自动补装所需库，所以需要分别发送这两个文件。包内还提供
`HP39DIR.CUR` / `HP39DIR.000`，用于使用目录包的传输软件；用 conn3x 单独发送
上述两个对象即可，不必把源码和说明书发送到计算器。

传完回到 Memory Manager，确认新增的是 `ARMToolbox39` / Library 275；然后在
APLET 列表确认存在 `ORCHARD RET`。若出现 `Undefined XLIB Name`、传输失败或
文件类型错误，记录原始错误，到这里停止，不重复更换库或重置机器。

此流程依据 Clock Tuner 作者对 39gs / conn3x 的安装说明；本探针的传输与安装
仍待这台机器实际验证。[作者说明](https://github.com/Arnie97/clock-tuner/blob/138efa3eca8f5745e6391e2544a7cc92694dbd48/README.md)

## 3. 运行与返回检查

1. 在 APLET 列表选中 `ORCHARD RET`，按 **START**。
2. 预期画面出现 **`ARM RETURN OK`**。这段文字由 SysRPL wrapper 在 ARM 调用
   正常返回后设置标记，再交给原系统绘制；ARM 本身不操作屏幕。
3. 按 **HOME** 返回，计算 `1+1`，应得到 `2`。再选中平常使用的 Function aplet，
   检查 START、HOME 和普通按键仍响应。
4. 再进入 `ORCHARD RET` 一次，重复返回；随后用你现有的连接软件传出一份
   无敏感内容的短笔记，检查传输仍可用。

请提供 **VERSION、库列表、`ARM RETURN OK` 画面，以及 HOME/计算/传输是否正常**。
若出现重启、卡住或错误，保留当时的画面与操作步骤；重新开机后能用，不能替代
本次“正常返回”的结果。

探针验证后可在 APLET 列表删除 `ORCHARD RET`。**不要直接删除 Library 275**：
其他 aplet 可能也依赖它，且库随关联 aplet 删除的行为尚未在本机核对。删除探针后
再检查库列表和原有 aplet。此次没有写入内部 Flash、升级系统或改动时钟的操作。

## 程序实际做了什么

ARM 载荷只有四字节 `1e ff 2f e1`，即 ARMv4T 的 `bx lr`。它直接使用启动器交给
它的返回地址，不读取数据内存、不写内存、不调用系统服务、不改时钟/中断寄存器。
V3 字符串带完整的八半字节对齐区；没有附加 linker 结构，所以配套库按原始
“零额外 RAM、无 MMU 重排”路线启动。库自身仍执行原有的内存整理和对象对齐。

启动器身份已完成此前缺失的验证：用 HPTools 从 39 专用 `lib275.s`、`SEXE.s`
及匹配的 HP entry 表重建后，得到与两个作者发布位置相同的 1,489 字节文件：

```text
88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1  lib275.sys
```

`tools/package-hp39-return.py` 另外独立读取最终 aplet 的反向目录链、四个代码入口、
唯一 `XLIB 275,0` 调用、ARM 字符串尺寸/标记/对齐区与 `bx lr` 指令。它不执行
SysRPL，因而没有把结构正确等同于原机运行正确。

原始构建/返回 ABI 依据是 HP-GCC 的
[39 专用启动器](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/HP39-Aplet/LIB275/SEXE.s)、
[V3 对象规范](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/ARMToolbox/LibFmt.txt)
及其 [LR 返回约定记录](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/hplib/hpsys.h)。

通过这一步以后，下一项才能是**固定短地址的只读采样与回传**，再核对物理地址
映射和完整 1 MiB 覆盖。本包没有包含尚未验证的读取指令。

## 包内内容与离线核验

包内有两个可传输对象、目录文件、中文说明、完整 probe 源码、构建/检查工具、
所用 HP-GCC 源文件与许可证、`manifest.json` 和 `SHA256SUMS`。**不含固件、
bootloader 或第三方编译器二进制。** 编译后的 aplet 与启动库按 GPLv2+ 分发，
随包提供完整对应源文件、构建脚本和许可证。Orchard 新写的源码保留兼容 GPL 的
MIT 许可；HP-GCC 库及头文件保留原许可与版权说明，位于单独目录，未并入模拟器核心。

有 Python 的电脑可以检查 ZIP，整个检查不联网：

```sh
python tools/package-hp39-return.py verify hp39gs-arm-return-v1.zip
```

开发者重建：使用 HPTools 3.0.8，先应用 Paul Onions 的 2019-04-26 64 位构建
补丁，再在解压目录执行以下命令。包内已包含所用的全部 HP39 源/头文件：

```sh
python tools/package-hp39-return.py build --hptools /path/to/hptools/bin /new/hp39gs-arm-return-v1.zip
```

在 Orchard 仓库中重建则补充
`--sdk /path/to/patched-hpgcc-1.1-sdk-for-hp39gs`。输入源码逐文件校验；库产物必须
匹配上面的固定 hash；输出路径已存在会拒绝覆盖。ZIP 条目顺序、时间和权限固定。
HPTools 的原始源包与本地使用的 64 位补丁链接在包内 `licenses/hpgcc39/NOTICE.md`。
一般用户直接使用已编译的两个对象，无需执行这些构建命令。
