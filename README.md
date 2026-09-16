# 周伟俊 - 个人作品集 (Weijun Zhou - Portfolio)

欢迎来到我的个人作品集网站。这是一个现代化的专业简历和作品展示平台。

## 📋 项目概述

一个基于 FINN 模板的个人品牌展示网站，用于展示专业经历、项目作品和技能特长。

- **网站地址**: https://Finnfuture.github.io/
- **作者**: 周伟俊 (Weijun Zhou)

## 🎯 功能特性

✨ **响应式设计** - 完美适配桌面、平板和移动设备  
🎨 **深色/浅色主题** - 一键切换视觉风格  
⚡ **快速加载** - 优化的前端性能  
📱 **专业布局** - 清晰的内容结构  
💼 **作品展示** - 图文结合的项目案例  
📝 **博客页面** - 分享技术文章和思考  
📧 **联系表单** - 访客反馈和消息提交  

## 📁 项目结构

```
├── index.html              # 首页
├── blog.html              # 博客列表页
├── blog-single.html       # 博客文章页
├── works.html             # 作品集列表
├── works-list.html        # 作品列表视图
├── work-single.html       # 作品详情页
├── assets/                # 前端资源
│   ├── css/              # 样式表
│   ├── js/               # JavaScript脚本
│   ├── images/           # 图片资源
│   └── fonts/            # 字体文件
├── mailer/               # 邮件表单处理
└── README.md             # 项目说明
```

## 🛠 技术栈

- **HTML5** - 语义化标记
- **CSS3** - 响应式样式（Bootstrap框架）
- **JavaScript** - 交互效果
- **PHP** - 邮件表单处理（可选）

## 📦 依赖库

- Bootstrap - 响应式布局框架
- Font Awesome - 图标库
- Swiper - 轮播组件
- Magnific Popup - 图片灯箱
- Animate.css - 动画效果

## 🚀 快速开始

1. **克隆仓库**
   ```bash
   git clone https://github.com/Finnfuture/Finnfuture.github.io.git
   cd Finnfuture.github.io
   ```

2. **本地预览**
   - 使用任何 HTTP 服务器打开项目
   - 推荐使用 VS Code 的 Live Server 扩展
   - 或直接在浏览器中打开 `index.html`

3. **自定义内容**
   - 编辑 HTML 文件修改内容
   - 更新 `assets/images/` 中的图片
   - 修改 CSS 自定义样式

## 📝 内容更新

- **修改个人信息**: 编辑 HTML 文件中的个人资料部分
- **更新作品案例**: 修改 `works.html` 和 `work-single.html`
- **发布博客**: 创建新的 `blog-single.html` 并在 `blog.html` 中链接
- **更换头像**: 替换 `assets/images/` 中的图片文件

## 📧 联系表单配置

表单提交功能需要配置邮件服务：

1. 编辑 `mailer/` 中的 PHP 文件
2. 配置接收邮箱地址
3. 测试表单提交功能

## 🎨 主题定制

支持深色和浅色两种主题：
- 点击右上角主题切换按钮
- 主题设置自动保存到本地浏览器

## 📱 浏览器兼容性

- Chrome (最新版本)
- Firefox (最新版本)
- Safari (最新版本)
- Edge (最新版本)

## 📄 许可证

本项目基于 FINN 模板，遵循相关授权协议。

## 🤝 反馈与建议

如有任何问题或建议，欢迎通过以下方式联系：
- GitHub Issues
- 网站联系表单
- 邮件直接沟通

## 🔧 本地开发指南

### 环境配置

无需特殊环境配置，直接在浏览器打开即可。可选配置：

```bash
# 使用 Python 启动本地服务器
python -m http.server 8000

# 或使用 Node.js http-server
npx http-server

# 访问网址
http://localhost:8000
```

### 修改建议

1. **个性化信息** - 更新你的姓名、职位、技能等
2. **联系方式** - 修改邮箱、电话、社交媒体链接
3. **作品案例** - 添加你的真实项目和成果
4. **配色方案** - 自定义 CSS 主题颜色
5. **字体选择** - 在 Google Fonts 中选择喜欢的字体

### 性能优化

- 图片已优化压缩
- CSS/JS 按需加载
- 支持深色模式减少眼睛疲劳
- 响应式设计确保各设备显示效果

---

**更新时间**: 2026年5月  
**版本**: 1.0  
**状态**: ✅ 生产环境  
**优化日期**: 2026-05-30
