# Trigger Trim

Windows 掌机 / Xbox 协议手柄的扳机行程校准预览工具。

## 结论

纯 GitHub Pages 网页不能让 Windows 或游戏收到改写后的扳机值。浏览器的 Gamepad API 只能读取手柄状态，不能把修正值写回系统级输入栈。这个项目当前交付的是：

- 自动枚举浏览器可见的手柄。
- 读取 LT / RT 原始值。
- 给 LT / RT 独立设置最小值和舒适满值。
- 实时预览修正后的输出。
- 保存本机 profile，并导出 JSON 给后续本地 companion 使用。

如果要让非浏览器游戏真正生效，需要本地 companion：读取物理手柄，应用 profile，输出虚拟 Xbox 手柄，并隐藏原物理设备以避免双输入。

## 本地使用

直接打开 `index.html` 即可。更接近 GitHub Pages 的方式是起一个本地 HTTP 服务：

```powershell
python -m http.server 4173
```

然后访问 `http://127.0.0.1:4173/`。

浏览器可能需要先按一下手柄按钮，`navigator.getGamepads()` 才会返回设备。

没有手柄时可以访问 `http://127.0.0.1:4173/?mock=1`，页面会使用模拟的 Xbox 手柄数据。可选参数：

```text
?mock=1&lt=26000&rt=28000
```

## 部署到 GitHub Pages

这个仓库已经包含 `.github/workflows/pages.yml`。推到 GitHub 后，在仓库设置里启用 GitHub Pages 的 GitHub Actions 来源即可。

## 映射公式

每个扳机独立使用：

```text
normalized = clamp((raw - min) / (comfortMax - min), 0, 1)
output = normalized ^ curve
```

其中 `raw`、`min`、`comfortMax` 都是 `0..1` 的浏览器归一化值。界面同时显示 Steam 风格的 `0..32767` 近似整数。

## 后续 native companion 边界

真正系统级生效的版本应拆成：

- Web UI：继续负责检测、调参、导出/推送 profile。
- Local service：监听 `localhost`，接收 profile。
- Input bridge：读取物理手柄的 XInput / HID 状态。
- Virtual device：用虚拟 Xbox 手柄把修正后的状态喂给 Windows。
- Device hiding：隐藏物理手柄，避免游戏同时看到原始和虚拟手柄。

驱动安装、反作弊兼容和设备隐藏都属于 native 层风险，不能由 GitHub Pages 静态页面解决。
