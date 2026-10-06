import { useState, useRef } from 'react'
import './index.css'

function VideoCard({ metadata, mode, computedSize }: { metadata: any, mode: string, computedSize: string }) {
  return (
    <div className="ibm-metadata">
      {metadata.thumbnail && (
        <img src={metadata.thumbnail} alt="Thumbnail" className="ibm-thumbnail" />
      )}
      <div className="ibm-meta-details">
        <div className="ibm-title">{metadata.name}</div>
        <div className="ibm-quality">Quality: {mode}</div>
        <div className="ibm-meta-item">Duration: {metadata.duration}s</div>
        <div className="ibm-meta-item">Size: {computedSize}</div>
        <div className="ibm-meta-item">Uploaded: {metadata.uploadDate}</div>
      </div>
    </div>
  )
}

function App() {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'OPTIMAL' | 'BEST' | 'CUSTOM'>('OPTIMAL')
  const [customLocation, setCustomLocation] = useState('')

  const [loading, setLoading] = useState(false)
  const [formats, setFormats] = useState<any[]>([])
  const [metadata, setMetadata] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedVideo, setSelectedVideo] = useState<string>('')
  const [selectedAudio, setSelectedAudio] = useState<string>('')

  const [downloading, setDownloading] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [downloadId, setDownloadId] = useState('')
  const [progressLog, setProgressLog] = useState('')
  const [downloadStatus, setDownloadStatus] = useState('')
  const [downloadPath, setDownloadPath] = useState('')

  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchInfo = async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setMetadata(null);
    setFormats([]);
    setSelectedVideo('');
    setSelectedAudio('');

    try {
      if (mode === 'CUSTOM') {
        const formatRes = await fetch(`http://localhost:3000/api/formats?url=${encodeURIComponent(url)}`);
        if (!formatRes.ok) {
          const errorData = await formatRes.json();
          throw new Error(errorData.error || 'Failed to fetch formats');
        }
        const formatData = await formatRes.json();
        setFormats(formatData.formats);

        // Populate basic metadata for custom view
        setMetadata({
          name: formatData.info.title,
          thumbnail: formatData.info.thumbnail,
          duration: formatData.info.duration,
          fileSize: 'Select formats below',
          uploadDate: 'Unknown'
        });
      } else {
        const metaRes = await fetch(`http://localhost:3000/api/metadata?url=${encodeURIComponent(url)}&mode=${mode}`);
        if (!metaRes.ok) {
          const errorData = await metaRes.json();
          throw new Error(errorData.error || 'Failed to fetch metadata');
        }
        const metaData = await metaRes.json();
        setMetadata(metaData);

        // Still fetch formats in case they want to switch mode, but it's optional
        const formatRes = await fetch(`http://localhost:3000/api/formats?url=${encodeURIComponent(url)}`);
        if (formatRes.ok) {
          const formatData = await formatRes.json();
          setFormats(formatData.formats);
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching information.');
    } finally {
      setLoading(false);
    }
  }

  const handleDownload = () => {
    if (mode === 'CUSTOM' && !selectedVideo && !selectedAudio) {
      setError('Please select at least one video or audio format for custom download.');
      return;
    }

    let customFormatStr = '';
    if (mode === 'CUSTOM') {
      if (selectedVideo && selectedAudio) {
        customFormatStr = `${selectedVideo}+${selectedAudio}`;
      } else if (selectedVideo) {
        customFormatStr = selectedVideo;
      } else if (selectedAudio) {
        customFormatStr = selectedAudio;
      }
    }

    setDownloading(true);
    setProgressLog('');
    setDownloadStatus('');
    setDownloadPath('');
    setError(null);

    let qs = `url=${encodeURIComponent(url)}&mode=${mode}`;
    if (mode === 'CUSTOM' && customFormatStr) qs += `&customFormat=${encodeURIComponent(customFormatStr)}`;
    if (customLocation) qs += `&customLocation=${encodeURIComponent(customLocation)}`;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`http://localhost:3000/api/download?${qs}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.status === 'starting') {
          setDownloadStatus('Starting download...');
          if (data.id) setDownloadId(data.id);
        } else if (data.status === 'downloading') {
          setDownloadStatus('Downloading...');
          setProgressLog(data.log);
        } else if (data.status === 'completed') {
          setDownloadStatus('Completed');
          setDownloadPath(data.filePath);
          setDownloading(false);
          setIsPaused(false);
          eventSource.close();
        } else if (data.status === 'error') {
          setError(data.error);
          setDownloading(false);
          setIsPaused(false);
          eventSource.close();
        }
      } catch (err) {
        console.error("Failed to parse SSE data", err);
      }
    };

    eventSource.onerror = () => {
      // Ignore errors if we intentionally paused
      if (!isPaused) {
        setError('Connection lost or an error occurred during download.');
        setDownloading(false);
      }
      eventSource.close();
    };
  }

  const handlePause = async () => {
    if (!downloadId) return;
    try {
      await fetch('http://localhost:3000/api/download/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: downloadId })
      });
      setIsPaused(true);
      setDownloadStatus('Paused');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    } catch (err) {
      console.error("Pause failed", err);
    }
  };

  const handleResume = () => {
    setIsPaused(false);
    handleDownload(); // Retrigger the download, yt-dlp will resume from .part
  };

  const handleCancel = async () => {
    if (downloadId) {
      try {
        await fetch('http://localhost:3000/api/download/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: downloadId })
        });
      } catch (err) {
        console.error("Cancel failed", err);
      }
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    handleStartOver();
  };

  const handleStartOver = () => {
    setUrl('');
    setMetadata(null);
    setFormats([]);
    setDownloading(false);
    setIsPaused(false);
    setDownloadId('');
    setDownloadStatus('');
    setDownloadPath('');
    setProgressLog('');
    setError(null);
  }

  // Filter formats for custom view
  const videoFormats = formats.filter(f => f.vcodec !== null && f.vcodec !== 'none' && f.resolution !== 'audio only');
  const audioFormats = formats.filter(f => f.acodec !== null && f.acodec !== 'none' && (f.vcodec === null || f.vcodec === 'none'));

  // Calculate dynamic file size for custom mode
  let computedSize = metadata?.fileSize || 'Unknown';
  if (mode === 'CUSTOM' && formats.length > 0 && (selectedVideo || selectedAudio)) {
    let totalBytes = 0;
    if (selectedVideo) {
      const vf = formats.find(f => f.format_id === selectedVideo);
      if (vf && vf.filesize_bytes) totalBytes += vf.filesize_bytes;
    }
    if (selectedAudio) {
      const af = formats.find(f => f.format_id === selectedAudio);
      if (af && af.filesize_bytes) totalBytes += af.filesize_bytes;
    }
    if (totalBytes > 0) {
      const gb = totalBytes / (1024 * 1024 * 1024);
      if (gb >= 1) computedSize = `${gb.toFixed(2)} GiB`;
      else computedSize = `${(totalBytes / (1024 * 1024)).toFixed(2)} MiB`;
    }
  }

  return (
    <div className="ibm-app">
      <h1 className="ibm-header">Save YT Video</h1>

      {!metadata && !downloading && !downloadPath && (
        <div className="ibm-card">
          <label className="ibm-label">YouTube URL</label>
          <input
            type="text"
            className="ibm-input"
            style={{ marginBottom: '1.5rem' }}
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <label className="ibm-label">Download Quality</label>
          <div className="ibm-radio-group">
            <label className="ibm-radio">
              <input type="radio" name="mode" checked={mode === 'OPTIMAL'} onChange={() => setMode('OPTIMAL')} />
              Optimal (1080p limit)
            </label>
            <label className="ibm-radio">
              <input type="radio" name="mode" checked={mode === 'BEST'} onChange={() => setMode('BEST')} />
              Best (Highest available)
            </label>
            <label className="ibm-radio">
              <input type="radio" name="mode" checked={mode === 'CUSTOM'} onChange={() => setMode('CUSTOM')} />
              Custom Selection
            </label>
          </div>

          <button className="ibm-button" onClick={fetchInfo} disabled={loading || !url}>
            {loading ? 'Fetching...' : 'Fetch Info'}
          </button>

          {error && <div className="ibm-error">{error}</div>}
        </div>
      )}

      {metadata && !downloadPath && !downloading && (
        <div className="ibm-card">
          <VideoCard metadata={metadata} mode={mode} computedSize={computedSize} />

          {/* Quality Mode was selected in the previous step */}

          {mode === 'CUSTOM' && (
            <div className="ibm-split-pane">
              <div className="ibm-pane">
                <div className="ibm-pane-title">Video Formats</div>
                {videoFormats.map(f => (
                  <label key={f.format_id} className="ibm-format-item">
                    <input
                      type="checkbox"
                      checked={selectedVideo === f.format_id}
                      onChange={(e) => setSelectedVideo(e.target.checked ? f.format_id : '')}
                    />
                    <div className="ibm-format-label">
                      <span>{f.resolution} ({f.ext})</span>
                      <span>{f.filesize}</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="ibm-pane">
                <div className="ibm-pane-title">Audio Formats</div>
                {audioFormats.map(f => (
                  <label key={f.format_id} className="ibm-format-item">
                    <input
                      type="checkbox"
                      checked={selectedAudio === f.format_id}
                      onChange={(e) => setSelectedAudio(e.target.checked ? f.format_id : '')}
                    />
                    <div className="ibm-format-label">
                      <span>{f.acodec} ({f.ext})</span>
                      <span>{f.filesize}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '2rem' }}>
            <label className="ibm-label">Download Location (Optional, Absolute Path)</label>
            <input
              type="text"
              className="ibm-input"
              placeholder="C:\Users\username\Downloads"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
            />
          </div>

          {error && <div className="ibm-error">{error}</div>}

          <div className="ibm-button-group">
            <button className="ibm-button" onClick={handleDownload}>
              Download Video
            </button>
            <button className="ibm-button ibm-button--secondary" onClick={handleStartOver}>
              Cancel / Start Over
            </button>
          </div>
        </div>
      )}

      {downloading && (
        <div className="ibm-card">
          <VideoCard metadata={metadata} mode={mode} computedSize={computedSize} />
          <div className="ibm-title">Downloading...</div>
          <div className="ibm-meta-item">{downloadStatus}</div>

          <div className="ibm-progress-area">
            {progressLog || 'Waiting for progress updates...'}
          </div>

          <div className="ibm-button-group">
            {isPaused ? (
              <button className="ibm-button" onClick={handleResume}>
                Resume Download
              </button>
            ) : (
              <button className="ibm-button ibm-button--secondary" onClick={handlePause}>
                Pause Download
              </button>
            )}

            <button className="ibm-button ibm-button--danger" onClick={handleCancel}>
              Cancel Process
            </button>
          </div>
        </div>
      )}

      {downloadPath && !downloading && (
        <div className="ibm-card">
          <VideoCard metadata={metadata} mode={mode} computedSize={computedSize} />
          <div className="ibm-download-success">
            <h3 style={{ margin: '0 0 1rem 0' }}>Download Completed Successfully!</h3>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: '14px' }}>{downloadPath}</p>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <button className="ibm-button" onClick={handleStartOver}>
              Download Another Video
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
