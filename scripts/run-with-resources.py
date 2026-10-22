"""Capture child resource usage on macOS without GNU time or sysctl access."""

import resource
import subprocess
import sys
from pathlib import Path

result = subprocess.run(sys.argv[2:], check=False)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
Path(sys.argv[1]).write_text(
    f"maximum resident set size (bytes): {usage.ru_maxrss}\n"
    f"user seconds: {usage.ru_utime}\nsystem seconds: {usage.ru_stime}\n",
    encoding="utf-8",
)
sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
