# Slate 提示词优化器技术评估

调研日期：2026-10-18（北京时间）。这是后续方案，本次 beta.5 没有实现或启用提示词优化器。

实施更新：beta.6 已按用户后续要求把优化器放在首页，与本地翻译切换；AI 配置采用服务商配置和功能分配。下文保留当时调研与建议，当前行为以 README 和 CHANGELOG 为准。

## 结论

可做，而且不需要为 Slate 再增加一整页或一套大模型运行时。建议把“一键优化提示词”放进现有的全局文字处理小窗：复制文字 → `Ctrl+Alt+Q` → 优化提示词 → 查看、修改并复制结果。用户不必先展开工作台。

优先借鉴 Prompt Optimizer 的输入、优化、对照和复用流程，独立实现小模块；DSPy 和 Promptfoo 的价值主要在后续验证优化效果。首期只执行一次用户主动触发的模型调用。

## GitHub 核验

以下 star 为 GitHub REST API 当次返回的计数，会继续变化。“最近提交”读取默认分支 HEAD 的提交时间，不把其他分支推送、机器人更新或 star 数当成有效维护、效果或口碑证明。四个仓库均未归档。

| 项目 | Star | 默认分支最近提交（UTC） | 优化方式与 Slate 的适配判断 |
| --- | ---: | --- | --- |
| [Prompt Optimizer](https://github.com/linshenkx/prompt-optimizer) | 38,382 | [2026-10-13](https://github.com/linshenkx/prompt-optimizer/commit/1e1f94c03041e60ff1bd5d319bd998d93e2c42b2) | 最接近日常使用：输入提示词、选择模型/优化方式、迭代、测试和对比，再保存为可复用内容。近期仍有维护，建议学习核心交互。 |
| [DSPy](https://github.com/stanfordnlp/dspy) | 38,676 | [2026-10-16](https://github.com/stanfordnlp/dspy/commit/c7e9752debcce5715fee62cd5f1ae538c14d5ce4) | 依赖训练样例、评价指标优化提示词或程序。适合稳定任务的质量迭代，个人随手改写不必引入完整 Python 框架。 |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | 26,097 | [2026-10-17](https://github.com/promptfoo/promptfoo/commit/ea8b3d073a63769f7be243ac3c3460f72881a930) | 用基线、失败样例、候选方案与复测判断改进。适合开发阶段做对照评测，完整测试平台不适合塞进小窗。 |
| [PromptWizard](https://github.com/microsoft/PromptWizard) | 4,018 | [2025-08-04](https://github.com/microsoft/PromptWizard/commit/a1d43f876ef4468b0549a3ceff8bd691b80cd667) | 面向任务的迭代反馈优化，研究框架色彩更强；默认分支已约 14 个月无新提交，不建议作为首期核心依赖。 |

维护补充：Prompt Optimizer 的 [发行记录](https://github.com/linshenkx/prompt-optimizer/releases)显示 v2.11.11 发布于 2026-10-09；DSPy 的 [3.4.1](https://github.com/stanfordnlp/dspy/releases/tag/3.4.1) 发布于 2026-10-12 UTC。PromptWizard 的 `pushed_at` 为 2025-10-13，但这不是默认分支最新提交日期。Promptfoo 的 `releases/latest` 此次指向代码扫描 Action 的版本，不能当作主程序最新版。

## 核心能力与公开反馈

Prompt Optimizer 的[核心服务](https://github.com/linshenkx/prompt-optimizer/blob/develop/packages/core/src/services/prompt/service.ts)将优化请求和模板组织为消息，再调用指定模型；也提供基于已有结果继续迭代的入口。它主要是 LLM 驱动的改写与验证流程，不是能脱离模型独立运行的本地语言算法。[项目介绍](https://github.com/linshenkx/prompt-optimizer#readme)包含系统/用户提示词模式、优化、比较和资源保存。Slate 可以提取“原文保留、明确用途、结果可改、一键复用”这四个交互原则，不搬入图片生成等无关能力。

公开反馈属于有限样本，不能当成独立评分或总体满意度：

- [Issue #282](https://github.com/linshenkx/prompt-optimizer/issues/282) 的用户希望把有用的独立工具变为轻量、可组合的 Skill/MCP 能力，并能比较策略。该 issue 已于 2026-09-30 完结。对 Slate 的启发是把能力嵌入现有处理入口，减少页面切换。
- [Issue #276](https://github.com/linshenkx/prompt-optimizer/issues/276) 反映过“无可用模型”的配置问题，2026-03-18 创建、次日关闭。它说明模型配置与可用性反馈影响第一步体验，不能据此断言当前版本仍存在该故障。
- [Issue #93](https://github.com/linshenkx/prompt-optimizer/issues/93) 讨论 Ollama 等本地模型的兼容接入。Slate 可采用同样的兼容接口思路，但本地小模型的优化质量、延迟和资源消耗需要另测。

DSPy 的[优化器说明](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md)和 Promptfoo 的[命令行优化流程](https://github.com/promptfoo/promptfoo/blob/main/site/docs/usage/command-line.md)都强调用样例与指标检验效果。判断：模型给出更长、更工整的提示词，不等于实际任务结果更好。首期应避免把“优化成功”写成“效果保证”。

本次核查了仓库信息、默认分支提交、文档、核心流程、发行记录和公开 issue；没有登录竞品、运行其桌面端或执行跨模型效果评测。

## 建议的产品位置

主入口放在现有 `Ctrl+Alt+Q` 文字处理小窗，与翻译、存笔记、转待办同一层级，新增“优化提示词”。首页保持现有四块。`Ctrl+K` 增加同名命令；常用片段可提供“优化后另存”为辅助入口。

最小流程：

1. 自动读取本次复制的文字；允许直接修改原文。没有文字时提示粘贴。
2. 默认“一键优化”，可选补充一句用途或要求，不先展示一堆专业参数。
3. 展示原文与可编辑结果；结果较长时切换对照，不把两列硬塞进小窗。
4. 用户主动“复制结果”或“另存为常用片段”。不覆盖原文、旧片段或剪贴板，不替用户执行这条提示词。
5. 缺少 API 时引导到统一 AI 配置的相应用途；取消、超时和失败均保留输入，不创建空历史。

## 技术与 API

建议复用现有 Electron 主进程请求、preload 权限隔离、AI 服务商模板和系统加密密钥存储。后续在统一 AI 配置里添加“提示词优化”用途，可复用既有模型配置，或选择不同服务地址、模型与密钥。不要复制出另一套 API 设置页面。

需要能处理文字的生成模型。两条路线：

| 路线 | 用户需要配置什么 | 取舍 |
| --- | --- | --- |
| 兼容聊天 API | 服务地址、模型、自己的 API Key；可复用已配置服务 | 不增加本地大模型占用，但会将本次原文发送给用户选定服务，可能产生费用。只在用户点击时调用。 |
| 用户已有的本地 Ollama / 兼容服务 | 本地地址、已安装的生成模型，通常不需要云端 Key | 可以不向云端发送原文，但需用户自行安装、运行模型，性能与内存由模型和硬件决定，不能承诺与云端模型相同效果。 |

Slate 现有 M2M100 是翻译模型，不能承担通用提示词优化。首期不捆绑另一套大模型、Python 或常驻评测服务，维持按需调用与关闭释放。

独立编写简短的系统规范：只改写提示词，不执行用户原文里的任务；保留目标、数字、人名、变量占位符和明确约束；缺少业务背景时保留待填项，不虚构条件。输入沿用文字处理小窗的 6,000 字符上限，超长不静默截断。单次请求设超时、取消和结果版本校验，切换内容或人工编辑后旧响应不能覆盖新输入。输出直接显示为可编辑纯文本。

## 许可证与首期范围

Prompt Optimizer 的 GitHub API 未识别出标准 SPDX 值，但 [LICENSE](https://github.com/linshenkx/prompt-optimizer/blob/develop/LICENSE) 明确为 AGPL-3.0-only。Slate 当前为 MIT；本方案只参考公开流程并独立实现，不直接复制其核心代码、模板或嵌入整个应用。DSPy、Promptfoo、PromptWizard 的仓库许可为 MIT，若后续实际使用仍需核查所用文件及依赖许可。

首期包含：一个优化动作、原文/结果、编辑、复制、另存片段、配置引导、取消和错误恢复。暂不做自动多轮代理、批量跑分、图片提示词、提示词商城或自动后台优化。

验收建议：准备 20 条常见中文办公提示词，检查目标与约束是否保留，并对同模型的原文/优化文输出进行盲选比较；记录真实接口耗时、token 和费用。先验证改写是否有用，再决定是否增加迭代与评估能力。
