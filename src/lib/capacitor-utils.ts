import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

// Simple mobile detection without Capacitor dependency
export const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Download functions using Capacitor Preferences
export const setDownloadData = async (key: string, data: string) => {
  await Preferences.set({
    key: `download_${key}`,
    value: data,
  });
};

export const getDownloadData = async (key: string) => {
  const { value } = await Preferences.get({ key: `download_${key}` });
  return value;
};

export const removeDownloadData = async (key: string) => {
  await Preferences.remove({ key: `download_${key}` });
};

// Upload functions using Capacitor Preferences
export const setUploadData = async (key: string, data: string) => {
  await Preferences.set({
    key: `upload_${key}`,
    value: data,
  });
};

export const getUploadData = async (key: string) => {
  const { value } = await Preferences.get({ key: `upload_${key}` });
  return value;
};

export const removeUploadData = async (key: string) => {
  await Preferences.remove({ key: `upload_${key}` });
};

// Filesystem-based download and upload functions
export const downloadAndSaveFile = async (url: string, fileName: string) => {
  try {
    const result = await Filesystem.downloadFile({
      path: fileName,
      url: url,
      directory: Directory.Documents, // Save to Documents directory
    });
    console.log('File downloaded to:', result.path);
    return result.path;
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
};

export const saveFileToFilesystem = async (fileName: string, content: string) => {
  try {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    console.log('File saved to:', result.uri);
    return result.uri;
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
};

export const readFileFromFilesystem = async (fileName: string) => {
  try {
    const result = await Filesystem.readFile({
      path: fileName,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return result.data;
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
};

export const deleteFileFromFilesystem = async (fileName: string) => {
  try {
    await Filesystem.deleteFile({
      path: fileName,
      directory: Directory.Documents,
    });
    console.log('File deleted:', fileName);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

export const listFilesInDirectory = async (directory: Directory = Directory.Documents) => {
  try {
    const result = await Filesystem.readdir({
      path: '',
      directory: directory,
    });
    return result.files;
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
};

export const getFileInfo = async (fileName: string) => {
  try {
    const result = await Filesystem.stat({
      path: fileName,
      directory: Directory.Documents,
    });
    return result;
  } catch (error) {
    console.error('Error getting file info:', error);
    throw error;
  }
};

// File picker for mobile (using input element as fallback)
export const pickFile = (): Promise<File> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,.csv,.shp,.zip';
    
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        resolve(file);
      } else {
        reject(new Error('No file selected'));
      }
    };
    
    input.click();
  });
};

// Read file content for mobile
export const readFileContent = async (file: File): Promise<string> => {
  if (isMobile()) {
    // On mobile, we can still use File.text() as it's supported
    return await file.text();
  } else {
    // Fallback for web
    return await file.text();
  }
};

// Enhanced download function that works on Android
export const saveFile = (filename: string, content: string, mimeType: string = 'application/json') => {
  try {
    if (isMobile()) {
      // For mobile devices, use a more robust approach
      const dataBlob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(dataBlob);
      
      // Create a more visible link for mobile
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'block';
      link.style.position = 'fixed';
      link.style.top = '0';
      link.style.left = '0';
      link.style.width = '100%';
      link.style.height = '100%';
      link.style.zIndex = '9999';
      link.style.opacity = '0';
      link.textContent = 'Download';
      
      // Add to DOM
      document.body.appendChild(link);
      
      // Try multiple methods to trigger download
      try {
        link.click();
      } catch (clickError) {
        console.warn('Click failed, trying dispatchEvent:', clickError);
        // Alternative method
        const event = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        link.dispatchEvent(event);
      }
      
      // Clean up after a delay
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 1000);
      
      return url;
    } else {
      // Web browsers - standard approach
      const dataBlob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      return url;
    }
  } catch (error) {
    console.error('Download failed:', error);
    throw new Error(`Failed to download ${filename}`);
  }
};

// Convert File to base64 (useful for mobile file operations)
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Remove data:mime/type;base64, prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = error => reject(error);
  });
};

// Alternative save method using data URL (better for Android)
export const downloadFile = (filename: string, content: string, mimeType: string = 'application/json') => {
  try {
    // Create data URL instead of blob URL (works better on Android)
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    return dataUrl;
  } catch (error) {
    console.error('Data URL download failed, trying blob:', error);
    
    // Fallback to blob method
    const dataBlob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return url;
  }
};

// Copy content to clipboard as fallback
export const copyToClipboard = async (content: string) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(content);
      return true;
    } else {
      // Fallback for older browsers or non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = document.execCommand('copy');
      document.body.removeChild(textArea);
      return result;
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};

// Create a visible download button for mobile devices
export const createDownloadButton = (filename: string, content: string, mimeType: string = 'application/json') => {
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  
  // Create a visible download button
  const button = document.createElement('button');
  button.textContent = `Download ${filename}`;
  button.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #007bff;
    color: white;
    border: none;
    padding: 15px 30px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    cursor: pointer;
  `;
  
  // Create the download link
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.style.display = 'none';
  
  button.onclick = () => {
    link.click();
    document.body.removeChild(button);
    document.body.removeChild(link);
  };
  
  // Add to DOM
  document.body.appendChild(link);
  document.body.appendChild(button);
  
  // Auto-remove after 30 seconds
  setTimeout(() => {
    if (document.body.contains(button)) {
      document.body.removeChild(button);
    }
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
  }, 30000);
  
  return button;
};

// Show message to user
export const showMessage = (message: string, isError: boolean = false) => {
  // Log to console
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }
  
  // Show alert for now (you can replace with toast library later)
  alert(message);
};
