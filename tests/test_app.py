
import io

import os
import unittest
from uuid import uuid4

from app import PDFFile, Group, SubGroup, TimelineTask, app, db


class APISmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config["TESTING"] = True

    def setUp(self):
        self.client = app.test_client()

    def tearDown(self):
        with app.app_context():
            test_files = PDFFile.query.filter(PDFFile.original_name.like("__copilot_test__%")).all()
            for file_row in test_files:
                file_path = os.path.join(app.config["UPLOAD_FOLDER"], file_row.stored_name)
                if os.path.exists(file_path):
                    os.remove(file_path)
                db.session.delete(file_row)

            test_subgroups = SubGroup.query.filter(SubGroup.name.like("__copilot_test__%")).all()
            for subgroup in test_subgroups:
                db.session.delete(subgroup)

            test_timeline_tasks = TimelineTask.query.filter(TimelineTask.title.like("__copilot_test__%")).all()
            for task in test_timeline_tasks:
                db.session.delete(task)

            test_groups = Group.query.filter(Group.name.like("__copilot_test__%")).all()
            for group in test_groups:
                db.session.delete(group)

            db.session.commit()

        upload_dir = app.config["UPLOAD_FOLDER"]
        for name in os.listdir(upload_dir):
            if name.startswith("__copilot_test__"):
                os.remove(os.path.join(upload_dir, name))

    def test_index_page_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Lecture File Manager", response.data)

    def test_group_create_and_delete_roundtrip(self):
        group_name = f"__copilot_test__group_{uuid4().hex[:8]}"

        create_response = self.client.post("/api/groups", json={"name": group_name})
        self.assertEqual(create_response.status_code, 201)
        group_id = create_response.get_json()["id"]

        list_response = self.client.get("/api/groups")
        self.assertEqual(list_response.status_code, 200)
        created = [g for g in list_response.get_json() if g["id"] == group_id]
        self.assertEqual(len(created), 1)

        delete_response = self.client.delete(f"/api/groups/{group_id}")
        self.assertEqual(delete_response.status_code, 200)

    def test_upload_rejects_mismatched_subgroup_group(self):
        suffix = uuid4().hex[:8]
        group_a_name = f"__copilot_test__group_a_{suffix}"
        group_b_name = f"__copilot_test__group_b_{suffix}"
        subgroup_name = f"__copilot_test__subgroup_{suffix}"

        group_a_id = self.client.post("/api/groups", json={"name": group_a_name}).get_json()["id"]
        group_b_id = self.client.post("/api/groups", json={"name": group_b_name}).get_json()["id"]
        subgroup_response = self.client.post(
            f"/api/groups/{group_b_id}/subgroups",
            json={"name": subgroup_name},
        )
        subgroup_id = subgroup_response.get_json()["id"]

        pdf_name = "__copilot_test__mismatch.pdf"
        response = self.client.post(
            "/api/files/upload",
            data={
                "group_id": str(group_a_id),
                "subgroup_id": str(subgroup_id),
                "file": (io.BytesIO(b"%PDF-1.4\n%%EOF\n"), pdf_name),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertIn("Sub-group does not belong", payload["error"])

        with app.app_context():
            self.assertIsNone(PDFFile.query.filter_by(original_name=pdf_name).first())

    def test_timeline_task_crud_and_validation(self):
        task_title = f"__copilot_test__timeline_{uuid4().hex[:8]}"

        create_response = self.client.post(
            "/api/timeline-tasks",
            json={
                "title": task_title,
                "start_date": "2026-03-10",
                "end_date": "2026-03-12",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        created = create_response.get_json()
        task_id = created["id"]

        list_response = self.client.get("/api/timeline-tasks")
        self.assertEqual(list_response.status_code, 200)
        self.assertTrue(any(task["id"] == task_id for task in list_response.get_json()))

        update_response = self.client.put(
            f"/api/timeline-tasks/{task_id}",
            json={"end_date": "2026-03-15"},
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.get_json()["end_date"], "2026-03-15")

        invalid_response = self.client.post(
            "/api/timeline-tasks",
            json={
                "title": f"{task_title}_invalid",
                "start_date": "2026-03-20",
                "end_date": "2026-03-12",
            },
        )
        self.assertEqual(invalid_response.status_code, 400)

        delete_response = self.client.delete(f"/api/timeline-tasks/{task_id}")
        self.assertEqual(delete_response.status_code, 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
