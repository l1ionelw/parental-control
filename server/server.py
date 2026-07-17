from flask import Flask
from flask_cors import CORS
from flask_sock import Sock

from api import api as api_blueprint
import trayapp_ws
import viewer_ws

app = Flask(__name__)
sock = Sock(app)

# The react-client is served from wherever it's deployed and points at this
# server's URL explicitly (see react-client/src/lib/apiConfig.js) rather than
# assuming same-origin, so /api requests are genuinely cross-origin.
CORS(app, resources={r"/api/*": {"origins": "*"}})

# REST API for the react-client frontend.
app.register_blueprint(api_blueprint, url_prefix="/api")


@sock.route("/ws")
def ws_handler(ws):
    """Tray-app connections: identity, telemetry, config sync, stream frames."""
    trayapp_ws.handle(ws)


@sock.route("/ws/viewer")
def ws_viewer_handler(ws):
    """Admin browser connections watching a device's screen share."""
    viewer_ws.handle(ws)


if __name__ == "__main__":
    # threaded=True is required by flask-sock: Werkzeug's dev server otherwise
    # handles one connection at a time, so a second long-lived websocket (e.g. a
    # viewer connecting while a trayapp is already connected) can't be accepted -
    # the client sees a garbled handshake response ("Invalid frame header").
    app.run(host="0.0.0.0", port=5002, debug=True, threaded=True)
