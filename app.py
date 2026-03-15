import os
import re
import secrets
from collections import Counter
from flask import Flask, request, jsonify, send_from_directory, render_template, abort, redirect
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.utils import secure_filename
from datetime import date, datetime, timezone
from llm import chat, chat_completion, LLMError

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

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
    sort_order = db.Column(db.Integer, default=0)
    share_token = db.Column(db.String(64), unique=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    files = db.relationship("PDFFile", backref="group", lazy=True)
    subgroups = db.relationship("SubGroup", backref="group", lazy=True, cascade="all, delete-orphan")

    topics_checklist = db.Column(db.Text, default="")
    todos_checklist = db.Column(db.Text, default="")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "sort_order": self.sort_order,
            "share_token": self.share_token,
            "topics_checklist": self.topics_checklist,
            "todos_checklist": self.todos_checklist,
            "created_at": self.created_at.isoformat(),
            "file_count": len(self.files),
            "subgroup_count": len(self.subgroups),
        }


class SubGroup(db.Model):
    __tablename__ = "subgroups"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    sort_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    files = db.relationship("PDFFile", backref="subgroup", lazy=True)

    __table_args__ = (
        db.UniqueConstraint("group_id", "name", name="uq_subgroup_group_name"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "group_id": self.group_id,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat(),
            "file_count": len(self.files),
        }


class PDFFile(db.Model):
    __tablename__ = "files"
    id = db.Column(db.Integer, primary_key=True)
    original_name = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(255), nullable=False, unique=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=True)
    subgroup_id = db.Column(db.Integer, db.ForeignKey("subgroups.id"), nullable=True)
    sort_order = db.Column(db.Integer, default=0)
    description = db.Column(db.Text, default="")
    summary = db.Column(db.Text, default="")
    flashcards = db.Column(db.Text, default="")
    example_tasks = db.Column(db.Text, default="")
    generated_tasks = db.Column(db.Text, default="")
    share_token = db.Column(db.String(64), unique=True, nullable=True)
    uploaded_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "original_name": self.original_name,
            "stored_name": self.stored_name,
            "group_id": self.group_id,
            "group_name": self.group.name if self.group else None,
            "subgroup_id": self.subgroup_id,
            "subgroup_name": self.subgroup.name if self.subgroup else None,
            "sort_order": self.sort_order,
            "description": self.description,
            "summary": self.summary,
            "flashcards": self.flashcards,
            "example_tasks": self.example_tasks,
            "generated_tasks": self.generated_tasks,
            "share_token": self.share_token,
            "uploaded_at": self.uploaded_at.isoformat(),
        }


class TimelineTask(db.Model):
    __tablename__ = "timeline_tasks"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=True)
    group = db.relationship("Group", backref=db.backref("timeline_tasks", lazy=True))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "group_id": self.group_id,
            "group_name": self.group.name if self.group else None,
            "created_at": self.created_at.isoformat(),
        }


with app.app_context():
    db.create_all()
    group_columns = {
        row[1] for row in db.session.execute(text("PRAGMA table_info(groups)")).fetchall()
    }
    if "sort_order" not in group_columns:
        db.session.execute(text("ALTER TABLE groups ADD COLUMN sort_order INTEGER DEFAULT 0"))
    if "share_token" not in group_columns:
        db.session.execute(text("ALTER TABLE groups ADD COLUMN share_token VARCHAR(64)"))
    if "topics_checklist" not in group_columns:
        db.session.execute(text("ALTER TABLE groups ADD COLUMN topics_checklist TEXT DEFAULT ''"))
    if "todos_checklist" not in group_columns:
        db.session.execute(text("ALTER TABLE groups ADD COLUMN todos_checklist TEXT DEFAULT ''"))

    subgroup_columns = {
        row[1] for row in db.session.execute(text("PRAGMA table_info(subgroups)")).fetchall()
    }
    if "sort_order" not in subgroup_columns:
        db.session.execute(text("ALTER TABLE subgroups ADD COLUMN sort_order INTEGER DEFAULT 0"))

    file_columns = {
        row[1] for row in db.session.execute(text("PRAGMA table_info(files)")).fetchall()
    }
    if "example_tasks" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN example_tasks TEXT DEFAULT ''"))
    if "generated_tasks" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN generated_tasks TEXT DEFAULT ''"))
    if "flashcards" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN flashcards TEXT DEFAULT ''"))
    if "subgroup_id" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN subgroup_id INTEGER"))
    if "sort_order" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN sort_order INTEGER DEFAULT 0"))
    if "share_token" not in file_columns:
        db.session.execute(text("ALTER TABLE files ADD COLUMN share_token VARCHAR(64)"))

    groups_for_bootstrap = Group.query.order_by(Group.sort_order.asc(), Group.name.asc()).all()
    if groups_for_bootstrap and all((g.sort_order or 0) == 0 for g in groups_for_bootstrap):
        for idx, group in enumerate(sorted(groups_for_bootstrap, key=lambda g: g.name.lower())):
            group.sort_order = idx + 1

    subgroups_for_bootstrap = SubGroup.query.order_by(SubGroup.group_id.asc(), SubGroup.name.asc()).all()
    if subgroups_for_bootstrap and all((s.sort_order or 0) == 0 for s in subgroups_for_bootstrap):
        grouped = {}
        for subgroup in subgroups_for_bootstrap:
            grouped.setdefault(subgroup.group_id, []).append(subgroup)
        for _, subgroup_list in grouped.items():
            for idx, subgroup in enumerate(sorted(subgroup_list, key=lambda s: s.name.lower())):
                subgroup.sort_order = idx + 1

    db.session.commit()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "pdf"


COMMON_STOPWORDS = {
    "about", "after", "again", "against", "also", "among", "because", "before",
    "between", "could", "every", "first", "from", "given", "having", "into",
    "itself", "lecture", "notes", "other", "should", "their", "there", "these",
    "those", "through", "under", "using", "where", "which", "while", "with",
    "would", "your", "this", "that", "what", "when", "have", "will", "than",
    "then", "them", "they", "been", "being", "file", "files", "document",
    "summary", "description", "task", "tasks", "page", "pages", "into", "such",
    "eine", "einer", "einen", "einem", "eines", "geben", "diese", "dieser",
    "dieses", "nicht", "durch", "unter", "sowie", "wurde", "werden", "kann",
    "können", "auch", "oder", "aber", "mehr", "beim", "über", "ohne", "nach",
    "noch", "alle", "beide", "weil", "dabei", "damit", "bereits", "thema",
    "blatt", "loesung", "lösung", "aufgabe", "aufgaben", "lecture", "material",
    "covers", "concepts", "applications", "tradeoffs", "topic", "topics", "main",
    "core", "ideas", "key",
}


def _extract_pdf_text(pdf_path: str, max_pages: int = 8) -> str:
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(pdf_path)
        chunks = []
        for page in reader.pages[:max_pages]:
            chunks.append(page.extract_text() or "")
        return "\n".join(chunks)
    except Exception:
        return ""


def _parse_ymd_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception as exc:
        raise ValueError("Date must be in YYYY-MM-DD format") from exc


def _tokenize_topic_words(text_value: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z\-]{3,}", text_value.lower())
    return [word for word in words if word not in COMMON_STOPWORDS]


def _extract_topic_terms(*parts: str, limit: int = 8) -> list[str]:
    counter = Counter()
    for part in parts:
        if part:
            counter.update(_tokenize_topic_words(part))
    return [word for word, _ in counter.most_common(limit)]


def _split_examples(example_tasks: str) -> list[str]:
    if not example_tasks:
        return []
    items = []
    for raw_line in example_tasks.splitlines():
        line = re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", raw_line).strip()
        if line:
            items.append(line)
    return items


def _infer_task_types(example_tasks: str) -> list[str]:
    examples = _split_examples(example_tasks)
    inferred = []
    for example in examples:
        lowered = example.lower()
        if any(word in lowered for word in ["compare", "contrast", "difference"]):
            inferred.append("comparison")
        elif any(word in lowered for word in ["design", "apply", "implement", "build", "create"]):
            inferred.append("application")
        elif any(word in lowered for word in ["evaluate", "critique", "justify", "assess"]):
            inferred.append("evaluation")
        elif any(word in lowered for word in ["calculate", "derive", "prove", "show"]):
            inferred.append("reasoning")
        else:
            inferred.append("concept")
    if inferred:
        ordered = []
        for task_type in inferred:
            if task_type not in ordered:
                ordered.append(task_type)
        return ordered
    return ["concept", "application", "comparison"]


def _build_aspects(topic_terms: list[str], context_text: str) -> list[str]:
    aspects = []
    for term in topic_terms[1:]:
        pretty = term.replace("-", " ")
        if pretty not in aspects:
            aspects.append(pretty)
    for sentence in re.split(r"(?<=[.!?])\s+", context_text):
        cleaned = sentence.strip()
        if 35 <= len(cleaned) <= 140:
            aspects.append(cleaned)
        if len(aspects) >= 8:
            break
    if not aspects:
        aspects = [
            "core ideas from the file",
            "a realistic use case",
            "a boundary condition",
            "a practical tradeoff",
        ]
    return aspects[:8]


def _pick_topic_label(pdf_file: PDFFile, topic_terms: list[str]) -> str:
    if topic_terms:
        return " ".join(topic_terms[:2]) if len(topic_terms) > 1 else topic_terms[0]
    filename = os.path.splitext(pdf_file.original_name)[0].replace("_", " ").replace("-", " ").strip()
    filename_terms = _extract_topic_terms(filename)
    if filename_terms:
        return " ".join(filename_terms[:2]) if len(filename_terms) > 1 else filename_terms[0]
    return "the concepts in this file"


def _generate_task_text(pdf_file: PDFFile, example_tasks: str, current_description: str, current_summary: str) -> str:
    pdf_text = _extract_pdf_text(os.path.join(app.config["UPLOAD_FOLDER"], pdf_file.stored_name))
    metadata_text = "\n".join(filter(None, [pdf_file.original_name, current_description, current_summary]))
    context_text = "\n".join(filter(None, [metadata_text, pdf_text]))
    metadata_terms = _extract_topic_terms(metadata_text)
    pdf_terms = _extract_topic_terms(pdf_text)
    topic_label = _pick_topic_label(pdf_file, metadata_terms)
    aspects = _build_aspects(pdf_terms or metadata_terms, metadata_text)
    task_types = _infer_task_types(example_tasks)
    examples = _split_examples(example_tasks)
    task_count = min(max(len(examples), 3), 5)

    templates = {
        "concept": [
            "Explain the core idea behind {topic} and connect it to {aspect}. Use a concrete example that is different from the source material.",
            "Identify the main principle in {topic} and explain why {aspect} matters when applying it.",
        ],
        "application": [
            "Apply {topic} to a new scenario involving {aspect}. Describe the steps you would take and justify the approach.",
            "Design a small solution based on {topic} that addresses {aspect} without repeating an example from the file.",
        ],
        "comparison": [
            "Compare two ways to approach {topic}, focusing on how each handles {aspect}. Conclude with when you would choose each one.",
            "Contrast a strong and weak use of {topic} in the context of {aspect}, and explain the practical consequences.",
        ],
        "evaluation": [
            "Evaluate a decision related to {topic} where {aspect} is the main constraint. Defend your conclusion with clear criteria.",
            "Critique a proposed approach to {topic} that emphasizes {aspect}. State what works, what fails, and how to improve it.",
        ],
        "reasoning": [
            "Work through a reasoning-heavy problem on {topic} that centers on {aspect}. Show the logic behind each step.",
            "Derive or justify an outcome in {topic} using {aspect} as the main condition. Make each inference explicit.",
        ],
    }

    generated = []
    for index in range(task_count):
        task_type = task_types[index % len(task_types)]
        aspect = aspects[index % len(aspects)]
        options = templates[task_type]
        template = options[index % len(options)]
        candidate = template.format(topic=topic_label, aspect=aspect)
        if candidate not in generated:
            generated.append(candidate)

    if len(generated) < task_count:
        fallback_aspects = [
            "an unfamiliar example",
            "a realistic constraint",
            "an edge case",
            "a practical decision",
        ]
        for aspect in fallback_aspects:
            candidate = (
                f"Create a non-repetitive task about {topic_label} that focuses on {aspect} and requires explanation, not recall."
            )
            if candidate not in generated:
                generated.append(candidate)
            if len(generated) == task_count:
                break

    return "\n\n".join(f"{index + 1}. {task}" for index, task in enumerate(generated))


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    return redirect("/static/favicon.svg", code=302)


@app.route("/shared/<share_token>")
def shared_view(share_token):
    group = Group.query.filter_by(share_token=share_token).first_or_404()
    subgroups = SubGroup.query.filter_by(group_id=group.id).order_by(
        SubGroup.sort_order.asc(), SubGroup.name.asc()
    ).all()
    root_files = PDFFile.query.filter_by(group_id=group.id, subgroup_id=None).order_by(
        PDFFile.sort_order.asc(), PDFFile.uploaded_at.asc()
    ).all()
    subgroup_files = PDFFile.query.filter(
        PDFFile.group_id == group.id,
        PDFFile.subgroup_id.is_not(None),
    ).order_by(PDFFile.subgroup_id.asc(), PDFFile.sort_order.asc(), PDFFile.uploaded_at.asc()).all()

    files_by_subgroup_id = {}
    for pdf_file in subgroup_files:
        files_by_subgroup_id.setdefault(pdf_file.subgroup_id, []).append(pdf_file)

    subgroup_data = []
    for sg in subgroups:
        sg_files = files_by_subgroup_id.get(sg.id, [])
        subgroup_data.append({"subgroup": sg, "files": sg_files})
    return render_template(
        "shared.html",
        group=group,
        root_files=root_files,
        subgroup_data=subgroup_data,
    )


@app.route("/shared/file/<share_token>")
def shared_file_view(share_token):
    shared_file = PDFFile.query.filter_by(share_token=share_token).first_or_404()
    return render_template("shared_file.html", file=shared_file)


# ---------------------------------------------------------------------------
# File API
# ---------------------------------------------------------------------------

@app.route("/api/files", methods=["GET"])
def list_files():
    group_id = request.args.get("group_id", type=int)
    subgroup_id = request.args.get("subgroup_id", type=int)
    root_only = request.args.get("root_only", "0") in {"1", "true", "True"}
    query = PDFFile.query
    if group_id is not None:
        query = query.filter_by(group_id=group_id)
    if subgroup_id is not None:
        query = query.filter_by(subgroup_id=subgroup_id)
    elif root_only:
        query = query.filter(PDFFile.subgroup_id.is_(None))
    files = query.order_by(PDFFile.sort_order.asc(), PDFFile.uploaded_at.asc()).all()
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

    group_id = request.form.get("group_id", type=int)
    subgroup_id = request.form.get("subgroup_id", type=int)
    if group_id is not None and not Group.query.get(group_id):
        return jsonify({"error": "Group not found"}), 404

    if subgroup_id is not None:
        subgroup = SubGroup.query.get(subgroup_id)
        if not subgroup:
            return jsonify({"error": "Sub-group not found"}), 404
        if group_id is None:
            group_id = subgroup.group_id
        elif subgroup.group_id != group_id:
            return jsonify({"error": "Sub-group does not belong to selected group"}), 400

    original_name = secure_filename(file.filename)
    base, ext = os.path.splitext(original_name)
    # Add randomness to avoid collisions in fast parallel uploads.
    stored_name = f"{base}_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{secrets.token_hex(4)}{ext}"
    file_path = os.path.join(app.config["UPLOAD_FOLDER"], stored_name)
    file.save(file_path)

    # Place new file at end of its group's sort order
    max_order = db.session.query(db.func.max(PDFFile.sort_order)).filter_by(
        group_id=group_id, subgroup_id=subgroup_id
    ).scalar() or 0

    pdf_file = PDFFile(
        original_name=original_name,
        stored_name=stored_name,
        group_id=group_id,
        subgroup_id=subgroup_id,
        sort_order=max_order + 1,
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
    if "flashcards" in data:
        f.flashcards = data["flashcards"]
    if "example_tasks" in data:
        f.example_tasks = data["example_tasks"]
    if "generated_tasks" in data:
        f.generated_tasks = data["generated_tasks"]
    if "group_id" in data:
        gid = data["group_id"]
        if gid is not None and not Group.query.get(gid):
            return jsonify({"error": "Group not found"}), 404
        f.group_id = gid
        if gid is None:
            f.subgroup_id = None
        elif f.subgroup_id is not None:
            subgroup = SubGroup.query.get(f.subgroup_id)
            if not subgroup or subgroup.group_id != gid:
                f.subgroup_id = None

    if "subgroup_id" in data:
        sgid = data["subgroup_id"]
        if sgid is None:
            f.subgroup_id = None
        else:
            subgroup = SubGroup.query.get(sgid)
            if not subgroup:
                return jsonify({"error": "Sub-group not found"}), 404
            if f.group_id is None:
                f.group_id = subgroup.group_id
            if subgroup.group_id != f.group_id:
                return jsonify({"error": "Sub-group does not belong to file's group"}), 400
            f.subgroup_id = sgid
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


@app.route("/api/files/<int:file_id>/share", methods=["POST"])
def share_file(file_id):
    f = PDFFile.query.get_or_404(file_id)
    if not f.share_token:
        f.share_token = secrets.token_urlsafe(32)
        db.session.commit()
    return jsonify({"share_token": f.share_token})


@app.route("/api/files/<int:file_id>/share", methods=["DELETE"])
def unshare_file(file_id):
    f = PDFFile.query.get_or_404(file_id)
    f.share_token = None
    db.session.commit()
    return jsonify({"message": "Share link revoked"})


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


@app.route("/api/files/<int:file_id>/generate-tasks", methods=["POST"])
def generate_tasks(file_id):
    f = PDFFile.query.get_or_404(file_id)
    data = request.get_json(silent=True) or {}

    original_name = data.get("original_name", f.original_name).strip()
    description = data.get("description", f.description)
    summary = data.get("summary", f.summary)
    example_tasks = data.get("example_tasks", f.example_tasks)

    if original_name:
        f.original_name = original_name
    f.description = description
    f.summary = summary
    f.example_tasks = example_tasks
    f.generated_tasks = _generate_task_text(f, example_tasks, description, summary)
    db.session.commit()

    return jsonify({
        "tasks": f.generated_tasks,
        "file": f.to_dict(),
    })


@app.route("/api/files/<int:file_id>/generate-flashcards", methods=["POST"])
def generate_flashcards(file_id):
    f = PDFFile.query.get_or_404(file_id)
    data = request.get_json(silent=True) or {}

    original_name = data.get("original_name", f.original_name).strip()
    description = data.get("description", f.description)
    summary = data.get("summary", f.summary)

    if original_name:
        f.original_name = original_name
    f.description = description
    f.summary = summary
    f.flashcards = _run_ai_flashcards(
        os.path.join(app.config["UPLOAD_FOLDER"], f.stored_name),
        f.original_name,
        description,
        summary,
    )
    db.session.commit()

    return jsonify({
        "flashcards": f.flashcards,
        "file": f.to_dict(),
    })


def _run_ai_summary(pdf_path: str) -> str:
    """
    Hook for an AI agent.  Replace this function's body to call your model.
    Receives the absolute path to the PDF and must return a summary string.
    The summary should include a 'Topics Covered' section listing key topics.
    """
    pdf_text = _extract_pdf_text(pdf_path, max_pages=10)
    if not pdf_text.strip():
        return "AI summary not yet configured. Replace _run_ai_summary() in app.py with your AI agent call."

    topic_terms = _extract_topic_terms(pdf_text, limit=12)
    if not topic_terms:
        return "AI summary not yet configured. Replace _run_ai_summary() in app.py with your AI agent call."

    # Try calling unified LLM (German-only output: topics list with deep bullets)
    system_prompt = (
        "Du bist ein ausführlicher, fachlich korrekter Dokumentenzusammenfasser. Antworte ausschließlich auf Deutsch. "
        "Extrahiere alle relevanten Themen aus dem Dokument und liefere ausschließlich eine strukturierte 'Themen'-Ausgabe in Markdown. "
        "Für jedes Thema gib den Thementitel (eine Zeile) und darunter 3-6 kurze, tiefgehende Bullet-Punkte an, die Aspekte, typische Anwendungen, Grenzen und weiterführende Details beschreiben. "
        "Keine Einleitungen, keine Erklärungen zur Methode, keine Fußnoten oder Hinweise; nur die Themenliste."
    )
    user_prompt = f"Dokument (die Ausgabe soll auf Deutsch erfolgen):\n\n{pdf_text}\n\nGib eine 'Themen' Auflistung zurück, wie oben beschrieben."
    try:
        result = chat(user_prompt, system_prompt=system_prompt, temperature=0.0, max_tokens=1500)
        if result and result.strip():
            return result.strip()
    except LLMError:
        # If LLM is not configured or call fails, fall back to local heuristic summary (German)
        pass

    # Fallback: local heuristic topics-only summary in German
    topics_lines = []
    for term in topic_terms[:8]:
        pretty = term.replace("-", " ").title()
        topics_lines.append(f"### {pretty}")
        topics_lines.append(f"- Kurzbeschreibung: Ein Überblick über {pretty} und seine zentralen Konzepte.")
        topics_lines.append(f"- Typische Anwendungen: Wann und wie {pretty} typischerweise eingesetzt wird.")
        topics_lines.append(f"- Wichtige Aspekte: Zentrale Punkte und mögliche Fallstricke, die beachtet werden sollten.")
        topics_lines.append("")

    return "\n".join(["# Themen"] + topics_lines)


def _run_ai_flashcards(pdf_path: str, original_name: str, description: str, summary: str) -> str:
    """
    Hook for AI flashcard generation.
    Returns text in RemNote-friendly `Front :: Back` format, one card per line.
    Attempts to use the unified LLM layer and falls back to local heuristics if unavailable.
    """
    pdf_text = _extract_pdf_text(pdf_path)
    context_text = "\n".join(filter(None, [original_name, description, summary, pdf_text]))

    # Try LLM-based generation first (German output)
    system_prompt = (
        "Du bist ein Experte für das Erstellen tiefgehender Lernkarten. Antworte ausschließlich auf Deutsch. "
        "Gib die Karten im Format 'Vorderseite :: Rückseite' aus, eine Karte pro Zeile. "
        "Erstelle für jedes im Kontext genannte Thema mehrere gründliche Karten (mindestens 2-4 pro Thema), die Schlüsselkonzepte, typische Anwendungen, Beispiele und mögliche Fallstricke abdecken. "
        "Formuliere präzise und vermeide redundante Karten. Gruppiere thematisch, wenn möglich."
    )
    user_prompt = f"Kontext:\n\n{context_text}\n\nErzeuge detaillierte Lernkarten auf Deutsch im 'Vorderseite :: Rückseite' Format und decke alle genannten Themen ausführlich ab."
    try:
        result = chat(user_prompt, system_prompt=system_prompt, temperature=0.2, max_tokens=1200)
        if result and result.strip():
            return result.strip()
    except LLMError:
        # Fall back to heuristic generation below (German)
        pass

    topic_terms = _extract_topic_terms(context_text, limit=10)
    topic_label = _pick_topic_label(
        PDFFile(original_name=original_name, stored_name="", description=description, summary=summary),
        topic_terms,
    )

    aspects = _build_aspects(topic_terms, context_text)
    if len(aspects) < 6:
        aspects.extend([
            "Kerndefinition",
            "typischer Anwendungsfall",
            "Hauptvorteil",
            "häufiger Fehler",
            "wichtiger Vergleich",
            "praktisches Beispiel",
        ])

    # Heuristic German flashcards covering typical angles
    cards = [
        f"Was ist die Kernidee von {topic_label}? :: Die Kernidee besteht darin, die Hauptprinzipien von {topic_label} zu verstehen und in passenden Kontexten anzuwenden, nicht nur Begriffe zu memorieren.",
        f"Wann sollte {topic_label} angewendet werden? :: {topic_label} ist nützlich, wenn {aspects[0]} relevant ist und eine strukturierte Herangehensweise benötigt wird.",
        f"Was ist ein häufiger Fehler bei {topic_label}? :: Ein häufiger Fehler ist, {aspects[1]} zu vernachlässigen, wodurch fehlerhafte Resultate entstehen können.",
        f"Wie überprüft man schnell das Verständnis von {topic_label}? :: Erkläre das Konzept in eigenen Worten und wende es auf ein kurzes Beispiel mit {aspects[2]} an.",
        f"Welcher Trade-off besteht bei {topic_label}? :: Oft besteht ein Trade-off zwischen Einfachheit und Vollständigkeit, besonders wenn {aspects[3]}.",
        f"Gib ein praktisches Beispiel für {topic_label}. :: Ein Beispiel ist die Anwendung bei {aspects[4]}, dabei sollten die Schritte begründet werden.",
    ]

    unique_cards = []
    for card in cards:
        if card not in unique_cards:
            unique_cards.append(card)

    return "\n".join(unique_cards[:8])


def _run_ai_group_topics(group_name: str, files_data: list[dict]) -> str:
    """
    Generates a hierarchical topics checklist: "over topics" are broad,
    cross-file themes used as section headers; "under topics" are specific
    concepts nested beneath the most relevant over topic.
    Attempts to use the unified LLM layer and falls back to local heuristics.
    """
    combined_text_parts = [group_name]
    file_term_sets: list[tuple[str, list[str]]] = []

    for f in files_data:
        parts = list(filter(None, [
            f.get("original_name", ""),
            f.get("description", ""),
            f.get("summary", ""),
        ]))
        file_text = "\n".join(parts)
        if file_text.strip():
            combined_text_parts.append(file_text)
            terms = _extract_topic_terms(file_text, limit=8)
            file_term_sets.append((file_text, terms))

    if not file_term_sets:
        return "# General\n- [ ] No file summaries available yet. Generate summaries for each file first."

    # Try LLM-based generation first
    files_text = "\n\n".join(f"Title: {f.get('original_name','')}\nDescription: {f.get('description','')}\nSummary: {f.get('summary','')}" for f in files_data)
    system_prompt = (
        "You are an assistant that produces a markdown topics checklist. Output top-level headers (# Header) for broad topics and '- [ ] item' lines for under-topics. "
        "Preserve clarity and avoid duplicates."
    )
    user_prompt = f"Given the group name: {group_name}\n\nFiles:\n{files_text}\n\nGenerate a markdown checklist grouping related concepts under clear headers."
    try:
        result = chat(user_prompt, system_prompt=system_prompt, temperature=0.0, max_tokens=1024)
        if result and result.strip():
            return result.strip()
    except LLMError:
        # Fall back to local heuristic implementation below
        pass

    n_files = len(file_term_sets)

    # Count how many distinct files each term appears in
    term_file_count: Counter = Counter()
    term_freq: Counter = Counter()
    for _, terms in file_term_sets:
        for term in set(terms):
            term_file_count[term] += 1
        term_freq.update(terms)

    # Over-topic: appears in 2+ files, OR single word with freq >= 3,
    # OR covers at least half the files
    over_topic_raw: list[str] = []
    under_topic_raw: list[str] = []
    seen_lower: set[str] = set()

    for term, freq in term_freq.most_common(28):
        pretty = term.replace("-", " ").title()
        if pretty.lower() in seen_lower:
            continue
        seen_lower.add(pretty.lower())
        is_broad = (
            term_file_count[term] >= 2
            or (" " not in term and freq >= 3)
            or (n_files >= 3 and term_file_count[term] >= n_files // 2)
        )
        if is_broad and len(over_topic_raw) < 7:
            over_topic_raw.append(term)
        elif len(under_topic_raw) < 22:
            under_topic_raw.append(term)

    # Fall back: promote top terms to over-topics if none qualified
    if not over_topic_raw:
        seen_lower = set()
        for term, _ in term_freq.most_common(24):
            pretty = term.replace("-", " ").title()
            if pretty.lower() not in seen_lower:
                seen_lower.add(pretty.lower())
                if len(over_topic_raw) < 4:
                    over_topic_raw.append(term)
                elif len(under_topic_raw) < 18:
                    under_topic_raw.append(term)

    # Assign each under-topic to the over-topic it most co-occurs with per file
    sections: dict[str, list[str]] = {term: [] for term in over_topic_raw}
    unassigned: list[str] = []
    over_lower_set = {t.lower() for t in over_topic_raw}

    for under_term in under_topic_raw:
        if under_term.lower() in over_lower_set:
            continue
        scores: Counter = Counter()
        for _, file_terms in file_term_sets:
            if under_term in file_terms:
                for over in over_topic_raw:
                    if over in file_terms:
                        scores[over] += 1
        pretty_under = under_term.replace("-", " ").title()
        if scores:
            best = scores.most_common(1)[0][0]
            sections[best].append(pretty_under)
        else:
            unassigned.append(pretty_under)

    # Build output
    output: list[str] = []
    for over_term in over_topic_raw:
        output.append(f"# {over_term.replace('-', ' ').title()}")
        for sub in sections[over_term][:5]:
            output.append(f"- [ ] {sub}")

    if unassigned:
        output.append("# General")
        for sub in unassigned[:6]:
            output.append(f"- [ ] {sub}")

    return "\n".join(output) if output else "# General\n- [ ] No topics could be extracted. Add descriptions or summaries to each file first."


def _parse_topics_checklist(text_value: str) -> list[dict]:
    sections = []
    current = None
    for raw in (text_value or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# "):
            current = {"header": line[2:].strip(), "items": []}
            sections.append(current)
        elif line.startswith("- ["):
            item = re.sub(r"^-\s*\[[ xX]\]\s*", "", line).strip()
            if not item:
                continue
            if current is None:
                current = {"header": "General", "items": []}
                sections.append(current)
            current["items"].append(item)
    return sections


def _serialize_topics_checklist(sections: list[dict]) -> str:
    lines = []
    for section in sections:
        header = (section.get("header") or "General").strip()
        items = [item.strip() for item in section.get("items", []) if item and item.strip()]
        if not header and not items:
            continue
        lines.append(f"# {header}")
        for item in items:
            lines.append(f"- [ ] {item}")
    return "\n".join(lines)


def _merge_topics_checklists(existing_text: str, generated_text: str) -> str:
    """
    Merge generated topics into existing list without modifying/removing existing ones.
    Existing order and labels are preserved; only new topics are appended.
    """
    existing_sections = _parse_topics_checklist(existing_text)
    generated_sections = _parse_topics_checklist(generated_text)

    if not generated_sections:
        return existing_text or ""
    if not existing_sections:
        return _serialize_topics_checklist(generated_sections)

    header_to_idx = {}
    global_items_lower = set()

    for idx, section in enumerate(existing_sections):
        header = (section.get("header") or "General").strip()
        if header.lower() not in header_to_idx:
            header_to_idx[header.lower()] = idx
        for item in section.get("items", []):
            global_items_lower.add(item.strip().lower())

    for gen_section in generated_sections:
        gen_header = (gen_section.get("header") or "General").strip()
        if gen_header.lower() in header_to_idx:
            target_idx = header_to_idx[gen_header.lower()]
        else:
            existing_sections.append({"header": gen_header or "General", "items": []})
            target_idx = len(existing_sections) - 1
            header_to_idx[(gen_header or "General").lower()] = target_idx

        target_items = existing_sections[target_idx]["items"]
        for item in gen_section.get("items", []):
            cleaned = item.strip()
            if cleaned and cleaned.lower() not in global_items_lower:
                target_items.append(cleaned)
                global_items_lower.add(cleaned.lower())

    return _serialize_topics_checklist(existing_sections)


@app.route("/api/groups/<int:group_id>/generate-topics", methods=["POST"])
def generate_group_topics(group_id):
    """
    Collects summaries from all files in the group (across all subgroups)
    and generates a checklist of topics covered.
    """
    group = Group.query.get_or_404(group_id)
    files = PDFFile.query.filter_by(group_id=group_id).all()
    files_data = [
        {
            "original_name": f.original_name,
            "description": f.description or "",
            "summary": f.summary or "",
        }
        for f in files
    ]
    generated = _run_ai_group_topics(group.name, files_data)
    group.topics_checklist = _merge_topics_checklists(group.topics_checklist or "", generated)
    db.session.commit()
    return jsonify({"topics_checklist": group.topics_checklist})


# ---------------------------------------------------------------------------
# Timeline API
# ---------------------------------------------------------------------------

@app.route("/api/timeline-tasks", methods=["GET"])
def list_timeline_tasks():
    group_id = request.args.get("group_id", type=int)
    query = TimelineTask.query
    if group_id is not None:
        query = query.filter_by(group_id=group_id)
    tasks = query.order_by(TimelineTask.start_date.asc(), TimelineTask.end_date.asc(), TimelineTask.id.asc()).all()
    return jsonify([task.to_dict() for task in tasks])


@app.route("/api/timeline-tasks", methods=["POST"])
def create_timeline_task():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Task title is required"}), 400

    start_raw = (data.get("start_date") or "").strip()
    end_raw = (data.get("end_date") or "").strip()
    if not start_raw or not end_raw:
        return jsonify({"error": "start_date and end_date are required"}), 400

    try:
        start_date = _parse_ymd_date(start_raw)
        end_date = _parse_ymd_date(end_raw)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if end_date < start_date:
        return jsonify({"error": "end_date must be the same as or after start_date"}), 400

    group_id = data.get("group_id")
    if group_id in {"", None}:
        group_id = None
    elif not Group.query.get(group_id):
        return jsonify({"error": "Group not found"}), 404

    task = TimelineTask(
        title=title,
        start_date=start_date,
        end_date=end_date,
        group_id=group_id,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route("/api/timeline-tasks/<int:task_id>", methods=["PUT"])
def update_timeline_task(task_id):
    task = TimelineTask.query.get_or_404(task_id)
    data = request.get_json(force=True)

    title = task.title
    start_date = task.start_date
    end_date = task.end_date
    group_id = task.group_id

    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "Task title is required"}), 400

    if "start_date" in data:
        start_raw = (data.get("start_date") or "").strip()
        if not start_raw:
            return jsonify({"error": "start_date is required"}), 400
        try:
            start_date = _parse_ymd_date(start_raw)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    if "end_date" in data:
        end_raw = (data.get("end_date") or "").strip()
        if not end_raw:
            return jsonify({"error": "end_date is required"}), 400
        try:
            end_date = _parse_ymd_date(end_raw)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    if end_date < start_date:
        return jsonify({"error": "end_date must be the same as or after start_date"}), 400

    if "group_id" in data:
        incoming_group_id = data.get("group_id")
        if incoming_group_id in {"", None}:
            group_id = None
        elif not Group.query.get(incoming_group_id):
            return jsonify({"error": "Group not found"}), 404
        else:
            group_id = incoming_group_id

    task.title = title
    task.start_date = start_date
    task.end_date = end_date
    task.group_id = group_id

    db.session.commit()
    return jsonify(task.to_dict())


@app.route("/api/timeline-tasks/<int:task_id>", methods=["DELETE"])
def delete_timeline_task(task_id):
    task = TimelineTask.query.get_or_404(task_id)
    db.session.delete(task)
    db.session.commit()
    return jsonify({"message": "Timeline task deleted"})


# ---------------------------------------------------------------------------
# Reorder API
# ---------------------------------------------------------------------------

@app.route("/api/files/reorder", methods=["PUT"])
def reorder_files():
    """Accept an ordered list of file IDs and update sort_order accordingly."""
    data = request.get_json(force=True)
    file_ids = data.get("file_ids", [])
    if not isinstance(file_ids, list):
        return jsonify({"error": "file_ids must be a list"}), 400
    for idx, fid in enumerate(file_ids):
        f = PDFFile.query.get(fid)
        if f:
            f.sort_order = idx
    db.session.commit()
    return jsonify({"message": "Order updated", "count": len(file_ids)})


@app.route("/api/files/<int:file_id>/move", methods=["PUT"])
def move_file_to_group(file_id):
    """Move a file to a different group/subgroup (used by drag-and-drop)."""
    f = PDFFile.query.get_or_404(file_id)
    data = request.get_json(force=True)
    group_id = data.get("group_id")
    subgroup_id = data.get("subgroup_id")

    if group_id is not None and group_id != "" and not Group.query.get(group_id):
        return jsonify({"error": "Group not found"}), 404
    if subgroup_id is not None and subgroup_id != "":
        sub = SubGroup.query.get(subgroup_id)
        if not sub:
            return jsonify({"error": "Sub-group not found"}), 404

    f.group_id = group_id if group_id else None
    f.subgroup_id = subgroup_id if subgroup_id else None

    # Place at end of new location
    max_order = db.session.query(db.func.max(PDFFile.sort_order)).filter_by(
        group_id=f.group_id, subgroup_id=f.subgroup_id
    ).scalar() or 0
    f.sort_order = max_order + 1

    db.session.commit()
    return jsonify(f.to_dict())


# ---------------------------------------------------------------------------
# Group API
# ---------------------------------------------------------------------------

@app.route("/api/groups", methods=["GET"])
def list_groups():
    groups = Group.query.order_by(Group.sort_order.asc(), Group.name.asc()).all()
    return jsonify([g.to_dict() for g in groups])


@app.route("/api/groups", methods=["POST"])
def create_group():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Group name is required"}), 400
    if Group.query.filter_by(name=name).first():
        return jsonify({"error": "A group with that name already exists"}), 409
    max_order = db.session.query(db.func.max(Group.sort_order)).scalar() or 0
    group = Group(name=name, sort_order=max_order + 1)
    db.session.add(group)
    db.session.commit()
    return jsonify(group.to_dict()), 201


@app.route("/api/groups/reorder", methods=["PUT"])
def reorder_groups():
    data = request.get_json(force=True)
    group_ids = data.get("group_ids", [])
    if not isinstance(group_ids, list):
        return jsonify({"error": "group_ids must be a list"}), 400

    for idx, group_id in enumerate(group_ids):
        group = Group.query.get(group_id)
        if group:
            group.sort_order = idx

    db.session.commit()
    return jsonify({"message": "Group order updated", "count": len(group_ids)})


@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    group = Group.query.get_or_404(group_id)
    data = request.get_json(force=True)
    if "name" in data:
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "Group name is required"}), 400
        if Group.query.filter(Group.name == name, Group.id != group_id).first():
            return jsonify({"error": "A group with that name already exists"}), 409
        group.name = name
    if "topics_checklist" in data:
        group.topics_checklist = data.get("topics_checklist", "")
    if "todos_checklist" in data:
        group.todos_checklist = data.get("todos_checklist", "")
    db.session.commit()
    return jsonify(group.to_dict())


@app.route("/api/groups/<int:group_id>/share", methods=["POST"])
def share_group(group_id):
    group = Group.query.get_or_404(group_id)
    if not group.share_token:
        group.share_token = secrets.token_urlsafe(32)
        db.session.commit()
    return jsonify({"share_token": group.share_token})


@app.route("/api/groups/<int:group_id>/share", methods=["DELETE"])
def unshare_group(group_id):
    group = Group.query.get_or_404(group_id)
    group.share_token = None
    db.session.commit()
    return jsonify({"message": "Share link revoked"})


@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    group = Group.query.get_or_404(group_id)
    # Unassign files from this group before deleting
    PDFFile.query.filter_by(group_id=group_id).update({"group_id": None, "subgroup_id": None})
    TimelineTask.query.filter_by(group_id=group_id).delete()
    SubGroup.query.filter_by(group_id=group_id).delete()
    db.session.delete(group)
    db.session.commit()
    return jsonify({"message": "Group deleted"})


# ---------------------------------------------------------------------------
# Sub-group API
# ---------------------------------------------------------------------------

@app.route("/api/groups/<int:group_id>/subgroups", methods=["GET"])
def list_subgroups(group_id):
    Group.query.get_or_404(group_id)
    subgroups = SubGroup.query.filter_by(group_id=group_id).order_by(SubGroup.sort_order.asc(), SubGroup.name.asc()).all()
    return jsonify([s.to_dict() for s in subgroups])


@app.route("/api/groups/<int:group_id>/subgroups", methods=["POST"])
def create_subgroup(group_id):
    Group.query.get_or_404(group_id)
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Sub-group name is required"}), 400
    exists = SubGroup.query.filter_by(group_id=group_id, name=name).first()
    if exists:
        return jsonify({"error": "A sub-group with that name already exists in this group"}), 409
    max_order = db.session.query(db.func.max(SubGroup.sort_order)).filter_by(group_id=group_id).scalar() or 0
    subgroup = SubGroup(name=name, group_id=group_id, sort_order=max_order + 1)
    db.session.add(subgroup)
    db.session.commit()
    return jsonify(subgroup.to_dict()), 201


@app.route("/api/groups/<int:group_id>/subgroups/reorder", methods=["PUT"])
def reorder_subgroups(group_id):
    Group.query.get_or_404(group_id)
    data = request.get_json(force=True)
    subgroup_ids = data.get("subgroup_ids", [])
    if not isinstance(subgroup_ids, list):
        return jsonify({"error": "subgroup_ids must be a list"}), 400

    existing_ids = {
        s.id for s in SubGroup.query.filter_by(group_id=group_id).all()
    }

    for idx, subgroup_id in enumerate(subgroup_ids):
        if subgroup_id not in existing_ids:
            continue
        subgroup = SubGroup.query.get(subgroup_id)
        if subgroup:
            subgroup.sort_order = idx

    db.session.commit()
    return jsonify({"message": "Sub-group order updated", "count": len(subgroup_ids)})


@app.route("/api/subgroups/<int:subgroup_id>", methods=["PUT"])
def update_subgroup(subgroup_id):
    subgroup = SubGroup.query.get_or_404(subgroup_id)
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Sub-group name is required"}), 400
    exists = SubGroup.query.filter(
        SubGroup.group_id == subgroup.group_id,
        SubGroup.name == name,
        SubGroup.id != subgroup_id,
    ).first()
    if exists:
        return jsonify({"error": "A sub-group with that name already exists in this group"}), 409
    subgroup.name = name
    db.session.commit()
    return jsonify(subgroup.to_dict())


@app.route("/api/subgroups/<int:subgroup_id>", methods=["DELETE"])
def delete_subgroup(subgroup_id):
    subgroup = SubGroup.query.get_or_404(subgroup_id)
    PDFFile.query.filter_by(subgroup_id=subgroup_id).update({"subgroup_id": None})
    db.session.delete(subgroup)
    db.session.commit()
    return jsonify({"message": "Sub-group deleted"})


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=5000)
