#!/usr/bin/env python3
"""
xdotool HTTP Server - Keyboard input and clipboard for moonlight-web streaming

Endpoints:
  POST /type      - Type text: {"text": "hello"}
  POST /key       - Send key combo: {"keys": "ctrl+c"}
  GET  /clipboard - Read remote clipboard (returns JSON: {"text": "..."})
  POST /clipboard - Write to remote clipboard: {"text": "..."}
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
import os

os.environ['DISPLAY'] = ':0'
os.environ['XAUTHORITY'] = '/home/ariana/.Xauthority'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            if self.path == '/clipboard':
                # Read from X11 clipboard using xclip
                result = subprocess.run(
                    ['xclip', '-selection', 'clipboard', '-o'],
                    env=os.environ, capture_output=True, timeout=5
                )
                text = result.stdout.decode('utf-8', errors='replace')

                self.send_response(200)
                self.send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'text': text}).encode())
            else:
                self.send_response(404)
                self.send_cors_headers()
                self.end_headers()
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length)) if length else {}

            if self.path == '/type':
                text = data.get('text', '')
                if text:
                    subprocess.run(['xdotool', 'type', '--clearmodifiers', '--', text],
                        env=os.environ, timeout=5)
            elif self.path == '/key':
                keys = data.get('keys', '')
                if keys:
                    subprocess.run(['xdotool', 'key', '--clearmodifiers', keys],
                        env=os.environ, timeout=5)
            elif self.path == '/clipboard':
                text = data.get('text', '')
                # Write to X11 clipboard using xclip
                proc = subprocess.Popen(
                    ['xclip', '-selection', 'clipboard'],
                    stdin=subprocess.PIPE, env=os.environ
                )
                proc.communicate(input=text.encode('utf-8'), timeout=5)

            self.send_response(200)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'ok')
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(str(e).encode())

if __name__ == '__main__':
    print('xdotool-server listening on :9091')
    HTTPServer(('0.0.0.0', 9091), Handler).serve_forever()
