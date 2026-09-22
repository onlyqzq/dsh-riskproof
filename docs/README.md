# 文档导航 / Documentation

[项目首页](../README.zh-CN.md) · [English overview](../README.md)

## 安装与使用 / Use

| 文档 | 内容 |
| --- | --- |
| [安装与首次使用](installation.md) | 本地候选包安装、启动、命令和任务范围 |
| [配置参考](configuration.md) | 防护模式、策略、输出控制、可信降密和记录上限 |
| [本地演示](../demo/README.md) | 无需模型的攻击链演示 |
| [Web 验收步骤](web-acceptance.zh-CN.md) | 浮标、风险概览、会话切换与移动端验证 |
| [从旧版 MCP 项目迁移](migration-from-riskproof.md) | 旧架构与当前 DSH 插件的区别 |

## 项目结构与开发 / Develop

| 文档 | 内容 |
| --- | --- |
| [架构](architecture.md) | 模块职责、工具调用流程与生命周期 |
| [开发指南](development.md) | 目录结构、构建、测试和打包命令 |
| [贡献指南](../CONTRIBUTING.md) | 贡献约定和提交前检查 |
| [更新记录](../CHANGELOG.md) | 已交付功能和未发布变更 |

代码阅读顺序：`src/index.ts` → `src/dsh/runtime.ts` → `src/core/engine.ts`。
界面阅读顺序：`src/dsh/dashboard.ts` → `src/experience/dashboard.ts` → `src/client/panel.ts`。

## 安全设计 / Security

- [安全模型与已知边界](security-model.md)
- [来源追踪与污点传播](provenance.md)
- [跨工具攻击链](toolchain.md)
- [漏洞报告](../SECURITY.md)

## 版本设计与验收记录 / Version records

这些文档记录对应版本的设计背景和验证结果；当前配置与操作方式以使用指南为准。

- [v0.4 输出控制与可信降密](v0.4-product-upgrade.md)
- [v0.3 产品迭代与榜单调研](v0.3-product-upgrade.md) · [验收记录](v0.3-validation.md)
- [v0.2 安全插件对比与迭代依据](v0.2-security-plugin-benchmark.md)
- [Awesome DSH Plugin 收录审核对齐记录](awesome-dsh-plugin-review.md)
