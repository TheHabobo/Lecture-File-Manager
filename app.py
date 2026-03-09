import os
from flask import Flask, request, jsonify, send_from_directory, render_template, abort
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from datetime import datetime, timezone

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(BASE_DIR, 'fms.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB limit

db = SQLAlchemy(app)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Group(db.Model):
    __tablename__ = "groups"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    files = db.relationship("PDFFile", backref="group", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat(),
            "file_count": len(self.files),
        }


class PDFFile(db.Model):
    __tablename__ = "files"
    id = db.Column(db.Integer, primary_key=True)
    original_name = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(255), nullable=False, unique=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=True)
    description = db.Column(db.Text, default="")
    summary = db.Column(db.Text, default="")
    uploaded_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "original_name": self.original_name,
            "stored_name": self.stored_name,
            "group_id": self.group_id,
            "group_name": self.group.name if self.group else None,
            "description": self.description,
            "summary": self.summary,
            "uploaded_at": self.uploaded_at.isoformat(),
        }


with app.app_context():
    db.create_all()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "pdf"


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# File API
# ---------------------------------------------------------------------------

@app.route("/api/files", methods=["GET"])
def list_files():
    group_id = request.args.get("group_id", type=int)
    query = PDFFile.query
    if group_id is not None:
        query = query.filter_by(group_id=group_id)
    files = query.order_by(PDFFile.uploaded_at.desc()).all()
    return jsonify([f.to_dict() for f in files])


@app.route("/api/files/<int:file_id>", methods=["GET"])
def get_file(file_id):
    f = PDFFile.query.get_or_404(file_id)
    return jsonify(f.to_dict())


@app.route("/api/files/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "Only PDF files are allowed"}), 400

    original_name = secure_filename(file.filename)
    # Make stored name unique using timestamp
    base, ext = os.path.splitext(original_name)
    stored_name = f"{base}_{int(datetime.now(timezone.utc).timestamp() * 1000)}{ext}"
    file_path = os.path.join(app.config["UPLOAD_FOLDER"], stored_name)
    file.save(file_path)

    group_id = request.form.get("group_id", type=int)
    pdf_file = PDFFile(
        original_name=original_name,
        stored_name=stored_name,
        group_id=group_id,
    )
    db.session.add(pdf_file)
    db.session.commit()
    return jsonify(pdf_file.to_dict()), 201


@app.route("/api/files/<int:file_id>", methods=["PUT"])
def update_file(file_id):
    f = PDFFile.query.get_or_404(file_id)
    data = request.get_json(force=True)
    if "description" in data:
        f.description = data["description"]
    if "summary" in data:
        f.summary = data["summary"]
    if "group_id" in data:
        gid = data["group_id"]
        if gid is not None and not Group.query.get(gid):
            return jsonify({"error": "Group not found"}), 404
        f.group_id = gid
    if "original_name" in data and data["original_name"].strip():
        f.original_name = data["original_name"].strip()
    db.session.commit()
    return jsonify(f.to_dict())


@app.route("/api/files/<int:file_id>", methods=["DELETE"])
def delete_file(file_id):
    f = PDFFile.query.get_or_404(file_id)
    # Remove from filesystem
    file_path = os.path.join(app.config["UPLOAD_FOLDER"], f.stored_name)
    if os.path.exists(file_path):
        os.remove(file_path)
    db.session.delete(f)
    db.session.commit()
    return jsonify({"message": "File deleted"})


@app.route("/api/files/<int:file_id>/pdf")
def serve_pdf(file_id):
    f = PDFFile.query.get_or_404(file_id)
    return send_from_directory(app.config["UPLOAD_FOLDER"], f.stored_name, mimetype="application/pdf")


# ---------------------------------------------------------------------------
# AI Summarization (placeholder – swap body for real AI call)
# ---------------------------------------------------------------------------

@app.route("/api/files/<int:file_id>/summarize", methods=["POST"])
def summarize_file(file_id):
    """
    Placeholder endpoint for AI-powered summarization.
    Replace the body of `_run_ai_summary` with your AI agent call.
    """
    f = PDFFile.query.get_or_404(file_id)
    summary = _run_ai_summary(os.path.join(app.config["UPLOAD_FOLDER"], f.stored_name))
    f.summary = summary
    db.session.commit()
    return jsonify({"summary": f.summary})


def _run_ai_summary(pdf_path: str) -> str:
    """
    Hook for an AI agent.  Replace this function's body to call your model.
    Receives the absolute path to the PDF and must return a summary string.
    """
    # TODO: integrate AI agent here
    return "AI summary not yet configured. Replace _run_ai_summary() in app.py with your AI agent call."


# ---------------------------------------------------------------------------
# Group API
# ---------------------------------------------------------------------------

@app.route("/api/groups", methods=["GET"])
def list_groups():
    groups = Group.query.order_by(Group.name).all()
    return jsonify([g.to_dict() for g in groups])


@app.route("/api/groups", methods=["POST"])
def create_group():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Group name is required"}), 400
    if Group.query.filter_by(name=name).first():
        return jsonify({"error": "A group with that name already exists"}), 409
    group = Group(name=name)
    db.session.add(group)
    db.session.commit()
    return jsonify(group.to_dict()), 201


@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    group = Group.query.get_or_404(group_id)
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Group name is required"}), 400
    if Group.query.filter(Group.name == name, Group.id != group_id).first():
        return jsonify({"error": "A group with that name already exists"}), 409
    group.name = name
    db.session.commit()
    return jsonify(group.to_dict())


@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    group = Group.query.get_or_404(group_id)
    # Unassign files from this group before deleting
    PDFFile.query.filter_by(group_id=group_id).update({"group_id": None})
    db.session.delete(group)
    db.session.commit()
    return jsonify({"message": "Group deleted"})


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=5000)
