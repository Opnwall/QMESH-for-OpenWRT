# QMESH 0.1.63 源码构建

## 内容

- `controller/`：控制器 RPC、HTTPS Agent 接口、LuCI 页面、样式和概览组件。
- `agent/`：AP Agent 和启动服务。
- `build.py`：Python 3 构建脚本，一体化包包含控制器和 Agent。
- `scripts/build-release.sh`：统一构建入口，生成 IPK、APK 构建输入和校验文件；有可用的 APK v3 工具时同时生成 APK。
- `README.md`：设备对应表、安装、升级及配置方法。
- GitHub Releases：已发布的 0.1.63 IPK、APK、源码整合包及校验文件。

## 构建 IPK

需要 Python 3、POSIX shell 和 tar，无需 OpenWrt SDK。进入解压后的源码根目录执行：

```sh
sh scripts/build-release.sh
```

输出至 `dist/`。如果本机没有支持 `mkpkg` 的 APK v3 工具，脚本仍生成 IPK 和 `apk-build-inputs.tar.gz`，并明确提示 APK 尚未构建。

## 构建 APK

需要支持 `mkpkg` 的 APK v3 工具，并在匹配其 CPU 架构的 Linux 环境运行。OpenWrt 自带 apk 不一定包含 mkpkg；macOS 无法直接运行 Linux 的 apk 二进制。本源码包不附带第三方 APK 工具。

工具已在 PATH 时：

```sh
sh scripts/build-release.sh
```

指定工具的绝对路径时：

```sh
APK_TOOL=/absolute/path/to/apk.static sh scripts/build-release.sh
```

也可先在 macOS 构建 IPK，再把 `dist/apk-build-inputs.tar.gz` 传至有适配工具的 Linux 主机。在空目录执行：

```sh
tar -xzf /path/to/apk-build-inputs.tar.gz
APK_TOOL=/absolute/path/to/apk.static sh build-apk.sh
```

生成 `luci-app-mesh-control-0.1.63-r1.apk`，这是本地未签名的 OpenWrt APK v3 软件包，安装时需要 `--allow-untrusted`。

## 修改与发布

修改 controller/、agent/ 后重新运行构建入口。更改版本时，同步修改 build.py 中一体化 IPK、APK 的版本与输出文件名，并更新 README；分包 Agent 有独立版本号。

构建输出目录应只存放本次构建文件，避免旧版本混入校验清单。SHA256 校验不代替签名或实机测试。安装到测试设备后，确认角色、无线配置和节点凭据保留，且 AP 在线、已同步；无线广播及漫游还需客户端实测。

源码 ZIP 内的 `SOURCE-SHA256SUMS` 覆盖全部随包文件（不包含清单自身）。进入源码根目录，macOS 执行 `shasum -a 256 -c SOURCE-SHA256SUMS`，Linux 执行 `sha256sum -c SOURCE-SHA256SUMS`。
