
CREATE POLICY "Users read own renders" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
