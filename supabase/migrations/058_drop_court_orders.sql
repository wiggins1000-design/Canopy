-- Migration 058: Remove court document checking feature

DROP FUNCTION IF EXISTS public.approve_court_order(uuid);
DROP TABLE IF EXISTS public.court_orders;
