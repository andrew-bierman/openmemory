"""Run the exact production reservation SQL against local SQLite, never D1 remote."""
import concurrent.futures
import pathlib
import re
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SQL = re.search(r'RESERVE_ATTEMPT_SQL = `([^`]+)`', (ROOT / 'src/worker.ts').read_text()).group(1)

class BudgetTests(unittest.TestCase):
    def test_atomic_cap_and_immutable_expiry(self):
        with tempfile.TemporaryDirectory(prefix='email-budget-') as directory:
            path = str(pathlib.Path(directory) / 'budget.db')
            with sqlite3.connect(path) as db:
                db.executescript((ROOT / 'migrations/0001_send_budget.sql').read_text())
            def reserve(expiry=200, now=100, run='approved'):
                with sqlite3.connect(path, timeout=10) as db:
                    return db.execute(SQL, (run, expiry, now, expiry, now)).fetchone()
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: reserve(), range(32)))
            self.assertEqual(sorted(row[0] for row in results if row), list(range(1, 13)))
            self.assertIsNone(reserve(expiry=300))
            self.assertIsNone(reserve(now=201))
            self.assertIsNone(reserve(run='expired-new', expiry=50))
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT attempts, expires_at FROM send_budget').fetchall(), [(12, 200)])

if __name__ == '__main__':
    unittest.main()
