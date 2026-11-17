#!/usr/bin/env python3
"""Build split opkg packages or stage the unified MESH release."""
import argparse
import gzip
import io
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parent

CONTROLLER_INSTALL = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT}" ] || exit 0
mkdir -p /etc/mesh-control
. /usr/share/mesh-control/common
mesh_saved_role=$(local_role)
touch /etc/config/qmesh || exit 1
uci set qmesh.main=main && uci set "qmesh.main.role=$mesh_saved_role" && uci commit qmesh || exit 1
printf '%s\n' "$mesh_saved_role" >/etc/mesh-control/role
# sysupgrade.conf survives firmware changes even if the plugin is not built in.
touch /etc/sysupgrade.conf
grep -qxF '/etc/mesh-control/' /etc/sysupgrade.conf || printf '\n/etc/mesh-control/\n' >>/etc/sysupgrade.conf
/usr/share/mesh-control/menu-sync "$mesh_saved_role"
rmdir /www/mesh-control 2>/dev/null || true
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*.json
overview=/www/luci-static/resources/view/status/index.js
# QWRT builds with a fixed include list need an explicit entry.
if [ -f "$overview" ] &&
   grep -Fq 'var includeModules=[' "$overview" &&
   grep -Fq "{name:'view.status.include.30_network'}" "$overview" &&
   ! grep -Fq 'view.status.include.35_mesh' "$overview"; then
    sed -i -e "s|,{name:'view.status.include.65_mesh'}||g" \
        -e "s|{name:'view.status.include.30_network'}|&,{name:'view.status.include.35_mesh'}|" "$overview"
fi
/etc/init.d/rpcd restart
"""
CONTROLLER_REMOVE = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT}" ] || exit 0
overview=/www/luci-static/resources/view/status/index.js
if [ -f "$overview" ] && grep -Fq "view.status.include.35_mesh" "$overview"; then
    sed -i "s|,{name:'view.status.include.35_mesh'}||g" "$overview"
fi
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*.json
/etc/init.d/rpcd restart
"""
REMOVE_AGENT = b"""#!/bin/sh
[ -z "${IPKG_INSTROOT}" ] || exit 0
[ ! -x /usr/sbin/mesh-backhaulctl ] || /usr/sbin/mesh-backhaulctl suspend 2>/dev/null || true
/etc/init.d/mesh-control-agent stop
/etc/init.d/mesh-control-agent disable
"""

def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, data, mode in entries:
            info = tarfile.TarInfo("./" + name)
            info.mode = mode
            if data is None:
                info.type = tarfile.DIRTYPE
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return gzip.compress(output.getvalue(), mtime=0)

def payload_for(role):
    folder = ROOT / role
    entries = [
        (path.relative_to(folder).as_posix(),
         path.read_bytes() if path.is_file() else None,
         path.stat().st_mode & 0o777)
        for path in sorted(folder.rglob("*"))
        if not any(part.startswith(".") for part in path.relative_to(folder).parts)
    ]
    if role == "controller":
        source = folder / "www/luci-static/resources/view/network/qmesh_ap.js"
        entries.append(("www/luci-static/resources/view/network/qmesh_ap_0163.js", source.read_bytes(), 0o644))
    return entries



def package(name, version, depends, scripts, payload, output_dir=ROOT, extra=""):
    control = f"""Package: {name}
Version: {version}
Architecture: all
Depends: {depends}
Section: net
Description: Central Wi-Fi management for OpenWrt
{extra}"""
    control_entries = [("control", control.encode(), 0o644)]
    control_entries.extend((script, data, 0o755) for script, data in scripts.items())
    output = output_dir / f"{name}_{version}_all.ipk"
    output.write_bytes(archive([
        ("debian-binary", b"2.0\n", 0o644),
        ("control.tar.gz", archive(control_entries), 0o644),
        ("data.tar.gz", archive(payload), 0o644),
    ]))
    print(output)

def unified(output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = sorted(set(payload_for("controller") + payload_for("agent")))
    install = CONTROLLER_INSTALL + b"""if [ "$(uci -q get mesh-backhaul.main.enabled)" = 1 ]; then
    /usr/sbin/mesh-backhaulctl enable
fi
if [ "$(cat /etc/mesh-control/role 2>/dev/null)" = ap ] &&
   [ -s /etc/config/mesh-control-agent ]; then
    /etc/init.d/mesh-control-agent enable &&
    /etc/init.d/mesh-control-agent restart
fi
"""
    dependencies = "libc, jshn, rpcd, uhttpd, uhttpd-mod-ubus, curl, uci, luci-base, openssl-util"
    package("luci-app-mesh-control", "0.1.63-1", dependencies + ", flock | busybox",
            {"postinst": install, "prerm": REMOVE_AGENT, "postrm": CONTROLLER_REMOVE},
            payload, output_dir,
            "Conflicts: mesh-control-controller, mesh-control-agent\n")
    apk_build = rb"""#!/bin/sh
set -eu
apk_tool=${APK_TOOL:-apk}
mkdir -m 755 root
tar -xzf payload.tar.gz -C root
"$apk_tool" mkpkg --files root \
  --info 'name:luci-app-mesh-control' --info 'version:0.1.63-r1' \
  --info 'arch:noarch' --info 'description:Central Wi-Fi management for OpenWrt' \
  --info 'depends:libc jshn rpcd uhttpd uhttpd-mod-ubus curl uci luci-base openssl-util busybox !mesh-control-controller !mesh-control-agent' \
  --script 'post-install:postinst' --script 'post-upgrade:postinst' \
  --script 'pre-deinstall:prerm' --script 'post-deinstall:postrm' \
  --output luci-app-mesh-control-0.1.63-r1.apk
"""
    (output_dir / "apk-build-inputs.tar.gz").write_bytes(archive([
        ("build-apk.sh", apk_build, 0o755),
        ("payload.tar.gz", archive(payload), 0o644),
        ("postinst", install, 0o755),
        ("prerm", REMOVE_AGENT, 0o755),
        ("postrm", CONTROLLER_REMOVE, 0o755),
    ]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--unified", type=Path, metavar="OUTPUT_DIR")
    args = parser.parse_args()
    if args.unified:
        unified(args.unified)
    else:
        package("mesh-control-controller", "0.1.63-1",
                "libc, jshn, flock | busybox, rpcd, uhttpd, uhttpd-mod-ubus",
                {"postinst": CONTROLLER_INSTALL, "postrm": CONTROLLER_REMOVE},
                payload_for("controller"))
        package("mesh-control-agent", "0.1.17-1", "libc, jshn, curl, uci",
                {"prerm": REMOVE_AGENT}, payload_for("agent"))
