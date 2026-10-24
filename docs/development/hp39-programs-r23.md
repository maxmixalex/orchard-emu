# r23 HP39 原版应用验证

后续进展：r24 已通过[架构 TLB 实现](arm920t-tlb.md#hp39g-native-return)修复下述
39g+ 的 ALIGN4 退出故障；两机均可正常返回和计算 `1+1=2`。原 GBP 0.3 包的
loader 对齐问题仍单独保留。以下内容及 r23 证据维持原验收时的结果。

本轮使用用户提供的完整 HP39g+、HP39gs ROM，正常物理按键和 stock USB 协议，
验证了 Arkalite 与 GBP39 Player 0.3。原包、诊断重建包和传输成功分别记录，
没有修改 ROM、直接写入 guest RAM 或放宽 ARM 对齐检查。
公开的[机器可读证据](evidence/hp39-programs-r23.json)只包含哈希、步骤和断言；
ROM、LCD 图片及检查点保留在私有测试目录。

## 结果

| 程序 | 原版 39g+ | 原版 39gs | 范围 |
| --- | --- | --- | --- |
| Arkalite 原包 | 通过 | 通过 | 冷启动、库/aplet 顺序 Wire 上传、stock SEND 回收一致、START、ENTER 游戏、左右移动、DEL 退出、HOME `1+1=2` |
| GBP 0.3 原包 | 首次 BSS 初始化触发 alignment fault | 同样失败 | Wire 上传及回收字节一致；不能把传输成功记成应用运行成功 |
| GBP 0.3 ALIGN4 诊断包 | 可进入和运行；ON 退出仍失败 | 通过 | 39gs 选曲、F6 游戏、四秒更新采样、ON 退出及 HOME 算术 |

最终执行验证固定使用 WASM SHA-256
`4bd0b8bba8ae7c71b116bb4a2c4396478e01730d9283bedc1f62a11f100db6e9`。
GBP 安装检查点先由参考 core 的原系统 Wire 流程生成，再在该最终候选上恢复和执行；
Arkalite 在最终候选上另做了两机冷启动安装。每一步的 core、ROM、输入文件和私有报告
哈希保存在证据 JSON 中。这些是短时模拟器工作流验证，不代表真机验证、全部游戏关卡、
音频精度或所有第三方程序兼容性。

## 原 GBP 0.3 为什么没有进入游戏

原包的完整 aplet SHA-256 为
`096985f550cdcf54a41fba68c6c418831715711bcf66ca7b00f33af94d7939a6`。
它与 `lib275.sys` 均经正常 Wire 接收，随后由原系统 SEND 导出；aplet 全文件和库
payload 均与输入一致。见[Wire 批量证据](evidence/hp39-wire-batch-r23.json)。

从已安装状态正常按 START，再重放到第一个 CPU fault，定位到原 HPGCC loader：

| 项目 | 原包值 |
| --- | --- |
| 首次故障指令 | `str ip, [r7, r0, lsl #2]` |
| 位置 | `c_loader + 0xa4`，此次加载的 PC 为 `0x0803ca04` |
| 写地址 | `0x090007f2` |
| Data fault status | `1`，alignment fault |
| CP15 control | `0xc000107f`，对齐检查开启 |
| `__got_size` | `0x1c` |
| `__data_size` | `0x3d6` |
| ELF 中真正的 `.bss` 起点 | `0x090007f4` |

原 loader 使用 `0x09000400 + __got_size + __data_size` 计算 BSS 清零起点，
并以 32 位字写入。原链接脚本在计算 `.data` 大小时没有包含末尾四字节对齐，
因此算出了比真正 `.bss` 提前两个字节的地址。两款原 ROM 上都捕获到这个首发错误，
39gs 最终候选再次复现；之后异常循环中出现的其他 FAR 值不能替代首发错误定位。

## 单独提供的 ALIGN4 诊断重建包

诊断包的计算器标题为 **GBP39 ALIGN4**，aplet SHA-256 为
`707e3892fef703780f95a84cd39ea2faa1393192e6812577496043503aa061dc`。
它是另一个文件，原 GBP 0.3 包保持原样。

源码修复在 `.data` 结尾加入 `. = ALIGN(4);`，使 `__data_size` 从 `0x3d6`
变为 `0x3d8`，清零地址与 ELF 的 `0x090007f4` 一致。`main.c` 和两份歌曲 JSON
逐字节保持不变。构建使用 LLVM 18 和作者原 HPGCC 1.1 的 loader/globals 对象；
重新编译会改变机器码，不能把它描述为仅改了原二进制中的两个字节。

HPGCC 原工具来自其 [SourceForge 官方项目归档](https://sourceforge.net/projects/hpgcc/files/hpgcc/HPGCC-1.1%20with%2039G%20support%20for%20Windows/)，
只提取安装包内容，没有执行 Windows 安装器。诊断 ZIP 包含所需原对象、对应源码、
许可证、补丁、构建脚本和来源哈希，不含 ROM 或 calculator checkpoint。
包内 `bash source/build.sh` 已实际重跑，输出 aplet 与上述哈希完全一致。

在原版 39gs 上，START 进入 SONG SELECT，F2/F1 切换选曲，F6 进入游戏；随后
正常 ON 退出并完成 HOME `1+1=2`。所有检查点 data fault status 和 stop reason
均为零。游戏运行四秒中以 60 Hz 取 240 份原始帧，出现 117 个不同帧哈希，
没有全空白帧。该数据只证明此采样窗口持续更新；屏幕响应与闪烁另由
[LCD 验证](lcd.md)记录。

39g+ 的限制仍然保留：同诊断包可以进入游戏，但按 ON 后，ROM IRQ 返回路径在
`0x00022a04` 的 `stmdb sp!, {lr}` 触发 page translation fault，状态 `7`，
此次首发地址 `0x0902dec8`。故障前 IRQ SP 为 `0x0902decc`。这里仅记录可重放
的现象，没有把根因归给程序或模拟器，也没有为通过测试绕过内存检查。
因此该包明确标为 **39gs 测试变体**。

## Arkalite 原包

使用 [Noda 的 HP39/40G 发布包](https://www.hpcalc.org/hp39/games/arkalite40.zip)，
ZIP SHA-256 为 `eebf2468764928ac0b89588a8787b6b3adb24f0c296cb6ac9e9765145afa480c`。
`ARKALITE.000` 和 `LIB1537L.000` 未改写，走原系统的 Saturn 应用执行路径。
两机各自冷启动后，首次 RECV 由正常按键开启，第二对象由生产自动续接器确认
原目录页面后按 RECV；随后原版 SEND 回收得到相同的 aplet 和库 payload。

运行时检查标题、ENTER 后的游戏画面、左右移动、DEL 返回、HOME 算术。
每个步骤的实际 LCD 均检查过，所有保存的状态中 data fault status 和 stop reason
为零。这一项同时验证了非 HPGCC 原生 ARM 游戏路径与库/aplet 批量传输。

Wire 安装及回收可用仓库工具复现；输出目录必须是新的私有目录：

```sh
node tools/verify-hp39-wire-batch.mjs /private/39gs.bin \
  /private/LIB1537L.000 /private/ARKALITE.000 /private/new-arkalite-result \
  --wasm dist/orchard.wasm
```

原版 GBP 和 ALIGN4 的同名 transfer 文件应来自各自独立目录，避免误把诊断包的
运行结果归给原包。证据 JSON 保留了所有输入哈希和正常按键步骤，便于分别复查。
