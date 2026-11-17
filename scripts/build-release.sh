#!/bin/sh
# Build unified IPK; build APK too when an APK v3 mkpkg tool is available.
set -eu
mesh_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mesh_output_dir=${1:-"$mesh_source_dir/dist"}
mkdir -p "$mesh_output_dir"
mesh_output_dir=$(CDPATH= cd -- "$mesh_output_dir" && pwd)
python3 "$mesh_source_dir/build.py" --unified "$mesh_output_dir"
mesh_apk_tool=${APK_TOOL:-apk}
if command -v "$mesh_apk_tool" >/dev/null 2>&1 && "$mesh_apk_tool" mkpkg --help >/dev/null 2>&1; then
    mesh_apk_tool=$(command -v "$mesh_apk_tool")
    case "$mesh_apk_tool" in /*) ;; *) mesh_apk_tool="$(pwd)/$mesh_apk_tool" ;; esac
    mesh_work_dir=$(mktemp -d)
    trap 'rm -rf "$mesh_work_dir"' EXIT HUP INT TERM
    tar -xzf "$mesh_output_dir/apk-build-inputs.tar.gz" -C "$mesh_work_dir"
    (cd "$mesh_work_dir" && APK_TOOL="$mesh_apk_tool" sh build-apk.sh)
    cp "$mesh_work_dir"/*.apk "$mesh_output_dir/"
else
    echo 'APK not built: use an APK v3 tool supporting mkpkg, or build apk-build-inputs.tar.gz on a compatible Linux host.' >&2
fi
python3 - "$mesh_output_dir" <<'PY'
import hashlib,sys
from pathlib import Path
p=Path(sys.argv[1])
files=sorted(list(p.glob('*.ipk'))+list(p.glob('*.apk')))
(p/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name+'\n' for f in files))
PY
echo "Build output: $mesh_output_dir"
