# QMESH 0.1.63：固件升级与资料保留

## 修复原因

旧版只依赖 `/etc/mesh-control/role` 和 Agent 自启动标记判断角色。设备固件的默认保留清单可能只包含 `/etc/config/`，遗漏角色和双回传证书；刷机后因此可能被识别为控制器。

0.1.63 将角色额外持久化到 `/etc/config/qmesh`。显式角色优先，兼容旧角色文件；两者缺失但 AP 接入字段完整时，恢复 AP 身份。安装时添加 `/etc/mesh-control/` 到 `/etc/sysupgrade.conf`，同时安装 `/lib/upgrade/keep.d/qmesh` 清单。

## 保留范围

| 路径 | 用途 |
| --- | --- |
| `/etc/config/qmesh` | 持久化控制器或 AP 角色 |
| `/etc/mesh-control/role` | 兼容旧版本的角色文件 |
| `/etc/config/mesh-control-agent` | AP 控制器地址、节点 ID、独立令牌、公钥指纹、无线接口 |
| `/etc/mesh-control/` | 控制器无线配置、节点凭据、接入码状态，以及已有双回传证书和私钥等 |
| `/etc/config/mesh-backhaul` | 已配对双回传的端口、对端、无线链路和启用状态 |

无线、网络、防火墙配置仍依赖固件自身保留机制，升级前也要检查。新装且未配置双回传的设备不会凭空生成配对证书。

## 升级前

先在旧固件安装 0.1.63，确认角色及同步正常，再检查实际备份清单：

```sh
sysupgrade -l | grep -E 'etc/config/(qmesh|mesh-control-agent|mesh-backhaul|wireless|network|firewall)|etc/mesh-control/'
umask 077
sysupgrade -b /root/qmesh-before-firmware.tar.gz
tar -tzf /root/qmesh-before-firmware.tar.gz | grep -E 'etc/config/(qmesh|mesh-control-agent|mesh-backhaul)|etc/mesh-control/'
```

把备份下载到电脑，避免刷机时丢失。备份包含 Wi-Fi 密码、节点令牌和证书私钥，不要上传群聊、代码库或公开发布。本发布包不包含实机配置、证书、私钥或接入码。

若备份缺少已有的角色或证书，请先停止升级并排查保留清单，不要以界面勾选“保留配置”代替核对归档。

## 刷机后

“保留配置”不等于保留额外安装的软件。新固件未内置 QMESH、OpenVPN 或所需依赖时，需要重装匹配新固件包管理器和架构的软件。不要跨内核强装旧 kmod；内核模块必须由新固件匹配的软件源提供。QMESH 的一体化包不会自动安装 OpenVPN 或自动完成双回传配对。

按 README 安装 IPK 或 APK 后核对：

```sh
uci -q get qmesh.main.role
cat /etc/mesh-control/role
# AP 才应启动 Agent
/etc/init.d/mesh-control-agent enabled
# 仅适用于已配置双回传的设备
uci -q get mesh-backhaul.main.enabled
ls -l /etc/mesh-control/backhaul/
/etc/init.d/mesh-backhaul enabled
cat /var/run/mesh-backhaul/mode
```

AP 应在控制器显示“在线、已同步”。检查 test 等原有 SSID 正常广播、可连接及可上网。双回传还须核对实际接线端口；逐台拔插验证，一次只断开一台，另一台保持有线上联。两台同时断开上联不能保证访问上级网络。

不要把一台 AP 的 Agent 配置直接复制给另一台，否则会共用节点身份。若令牌或证书备份缺失，应重新接入或重新配对。

## 本次验证与边界（2026-11-12）

- 101.1、18.1、18.2、18.3 升级到 0.1.63；101.19、101.20 已先行升级。控制器及 AP 角色保留。
- 101.19、101.20、18.2、18.3 在各自控制器上在线、已同步。
- 实际 `sysupgrade -b` 归档已确认包含各台角色资料；101.19、101.20 归档还包含双回传 UCI 配置、证书和私钥。
- 101.19 有线上联为 lan1，101.20 为 lan3；专用 2.4 GHz 回传链路与客户端 AP 配置分开。20 实际拔线进入 wireless，19 进入 wired-relay；插回后两台恢复 wired。未取得完整切换丢包统计。
- 18 网段本次更新设备未配置双回传，因此只验证角色和 AP 接入资料；未对其新建配对。
- 18.4、18.5 无法连接，未升级，也不能确认其当前地址对应关系。
- 本次检查了实际备份归档，未重新刷固件或冷启动验证；IPv6、长期负载及大规模部署也未完成验证。

升级后若角色错误，先查看上述 UCI 和角色文件，不要直接生成新控制器配置覆盖原有接入资料。
