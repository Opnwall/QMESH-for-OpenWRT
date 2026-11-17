from pathlib import Path
import subprocess,tempfile
source=Path('agent/usr/sbin/mesh-control-agent').read_text()
function=source[source.index('rf_survey() {'):source.index('report_radios() {')]
with tempfile.TemporaryDirectory() as tmp:
 function=function.replace('/tmp/mesh-rf-',tmp+'/rf-')
 script='''uci() { echo 0; }
date() { echo 1000; }
rf_scan() { echo scan >>"COUNTER"; printf 'Cell 01 - Address: 00:11:22:33:44:55\\n Channel: 36\\n Signal: -45 dBm\\n'; }
'''.replace('COUNTER',tmp+'/count')+function+f'''
printf '900 36~-70~1\\n' >'{tmp}/rf-rai'
survey_request= survey_ack=
rf_survey rai rai0
[ ! -e '{tmp}/count' ] || exit 1
survey_request=nonce
rf_survey rai rai0
[ "$(wc -l <'{tmp}/count')" -eq 1 ] || exit 2
survey_ack=nonce
rf_survey rai rai0
[ "$(wc -l <'{tmp}/count')" -eq 1 ] || exit 3
'''
 result=subprocess.run(['sh','-c',script],capture_output=True,text=True)
 assert result.returncode==0,result.stderr
 assert 'rai:900:36~-70~1' in result.stdout,result.stdout
 assert result.stdout.count('rai:1000:36~-45~1')==2,result.stdout
print('on-demand scan and cache checks passed')
