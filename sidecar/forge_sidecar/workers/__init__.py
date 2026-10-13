"""Child processes the AI helper runs, never code it imports.

A worker here is started as ``python -m forge_sidecar.workers.<name>`` with
its own environment, and talks to the capability that started it through its
pipes and the files it writes. It lives apart because something in it must
not share the helper's process:

- ``mp_faces`` — MediaPipe's face detector (docs/CLIPS.md §4.3). Its macOS
  wheel aborts the whole process (SIGABRT, return code -6) where there is no
  Metal device, even on the CPU delegate (docs/EFFECTS.md §37), and it imports
  ``cv2`` and ``matplotlib.pyplot`` that only the empty stubs in
  ``forge_sidecar/stubs`` satisfy. The stubs go first on the WORKER's
  ``PYTHONPATH`` alone, so a real ``cv2`` installed later is never shadowed in
  the helper, and an abort ends the worker, which ``capabilities/faces.py``
  reports as ``Unavailable`` while the helper keeps answering.

Nothing in this package is imported by the helper. A worker that cannot
import its library exits, and the capability that ran it answers that request
``Unavailable``: the worker's own import is the real check, made per run, not
a degraded row in ``system.hello`` (registration only asks
``importlib.util.find_spec``).
"""
