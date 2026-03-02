"""Supabase connection config. Reads from environment variables."""

import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")


def get_supabase():
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
