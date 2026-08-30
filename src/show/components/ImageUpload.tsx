import { useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  bucket?: string;
  folder?: string;
  label?: string;
  maxSizeMB?: number;
}

export function ImageUpload({
  value,
  onChange,
  bucket = 'avatars',
  folder = 'agents',
  label = 'Image',
  maxSizeMB = 5,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>(value);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    const maxSize = maxSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
      setError(`Le fichier est trop grand. Taille max: ${maxSizeMB}MB`);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image');
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { data, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      setPreview(publicUrl);
      onChange(publicUrl);
    } catch (err) {
      console.error('Upload error:', err);
      if (err instanceof Error) {
        if (err.message.includes('new row violates row-level security')) {
          setError('Erreur de permissions. Veuillez créer le bucket "avatars" dans Supabase Storage avec les permissions publiques.');
        } else {
          setError(`Erreur d'upload: ${err.message}`);
        }
      } else {
        setError('Erreur d\'upload inconnue');
      }
    } finally {
      setUploading(false);
    }
  }

  function handleClear() {
    setPreview('');
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleClick() {
    fileInputRef.current?.click();
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-white/40 mb-1">{label}</label>

      <div className="flex gap-3 items-start">
        {preview ? (
          <div className="relative group">
            <img
              src={preview}
              alt="Preview"
              className="w-24 h-24 rounded-2xl object-cover border border-white/10"
            />
            <button
              type="button"
              onClick={handleClear}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 border-2 border-[#08090d] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        ) : (
          <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-white/20" />
          </div>
        )}

        <div className="flex-1 space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={handleClick}
            disabled={uploading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm hover:bg-white/[0.06] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Upload en cours...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {preview ? 'Changer l\'image' : 'Uploader une image'}
              </>
            )}
          </button>

          <div className="text-xs text-white/30">
            <p>Format: JPG, PNG, GIF (max {maxSizeMB}MB)</p>
            {preview && (
              <p className="mt-1 text-white/40 truncate">URL: {preview}</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
