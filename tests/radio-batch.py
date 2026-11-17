from pathlib import Path
import subprocess
common=Path('controller/usr/share/mesh-control/common').read_text()
agent=Path('agent/usr/sbin/mesh-control-agent').read_text()
validator=common[common.index('valid_radio_changes()'):]
assert validator.strip() in agent
prefix=common[common.index('radio_value_allowed()'):common.index('valid_channel_changes()')]
cases=[('ra:6:20:25,rai:149:40:20',True),('ra:-:20:-,rai:36:-:25',True),('ra:6:20:25,ra:11:20:25',False),('rai:999:20:25',False),('rai:36:80:25',False),('rai:36:40:101',False),('rai:-:-:-',False),('rai:36:40:25,',False),('rai:36:40:25:7',False)]
for value,ok in cases:
 cmd=prefix+validator+f"\nvalid_radio_changes 'ra:1,6,11 rai:36,149' 'ra:20,40 rai:20,40' 'ra:20,25 rai:20,25' '{value}'\n"
 result=subprocess.run(['sh','-c',cmd]).returncode==0
 assert result==ok,(value,result)
print('batch radio validation checks passed')
