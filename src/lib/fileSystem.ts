import { SemanticNetwork, FileOperationResult, ExportFormat } from '@/types'

/**
 * File system integration for saving and loading semantic networks
 */
export class FileSystemManager {
  private static instance: FileSystemManager | null = null
  private hasFileSystemAccess: boolean
  private currentFileHandle: any = null // Store the current file handle

  private constructor() {
    this.hasFileSystemAccess = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window
    // Note: File handles cannot be persisted across page reloads due to browser security
    // The user will need to use "Open" to re-establish the file handle after page refresh
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): FileSystemManager {
    if (!FileSystemManager.instance) {
      FileSystemManager.instance = new FileSystemManager()
    }
    return FileSystemManager.instance
  }

  /**
   * Save semantic network to file
   */
  async saveFile(network: SemanticNetwork, filename?: string, forceNewFile: boolean = false): Promise<FileOperationResult> {
    try {
      const jsonData = JSON.stringify(network, null, 2)
      
      if (this.hasFileSystemAccess) {
        return await this.saveWithFileSystemAPI(jsonData, filename, forceNewFile)
      } else {
        return this.saveWithDownload(jsonData, filename || 'semantic-network.json')
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Load semantic network from file
   */
  async loadFile(): Promise<FileOperationResult> {
    try {
      if (this.hasFileSystemAccess) {
        return await this.loadWithFileSystemAPI()
      } else {
        return await this.loadWithInput()
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Load a specific file by filename (for auto-loading stored files)
   * Note: This is limited by browser security - can only access files the user has previously granted access to
   */
  async loadSpecificFile(_filename: string): Promise<FileOperationResult> {
    try {
      // For File System Access API, we need to use a different approach
      // since we can't directly access arbitrary files by path for security reasons
      // This method will primarily work with recently accessed files or through user permission
      
      if (this.hasFileSystemAccess) {
        // In practice, we can't directly load files by filename due to security restrictions
        // This is more of a placeholder - the actual auto-loading will rely on
        // the user having previously granted access to the file
        return {
          success: false,
          message: 'Cannot auto-load specific files due to browser security restrictions'
        }
      } else {
        return {
          success: false,
          message: 'File System Access API not supported'
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to load specific file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Export data in different formats
   */
  async exportData(network: SemanticNetwork, format: ExportFormat, filename?: string): Promise<FileOperationResult> {
    try {
      let content: string
      let defaultFilename: string
      let mimeType: string

      switch (format) {
        case 'json':
          content = JSON.stringify(network, null, 2)
          defaultFilename = 'semantic-network.json'
          mimeType = 'application/json'
          break
        case 'csv':
          content = this.convertToCSV(network)
          defaultFilename = 'semantic-network.csv'
          mimeType = 'text/csv'
          break
        case 'txt':
          content = this.convertToText(network)
          defaultFilename = 'semantic-network.txt'
          mimeType = 'text/plain'
          break
        default:
          throw new Error('Unsupported export format')
      }

      if (this.hasFileSystemAccess) {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: filename || defaultFilename,
          types: [{
            description: `${format.toUpperCase()} files`,
            accept: { [mimeType]: [`.${format}`] }
          }]
        })

        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()

        return {
          success: true,
          message: 'File exported successfully',
          filename: fileHandle.name
        }
      } else {
        this.downloadFile(content, filename || defaultFilename, mimeType)
        return {
          success: true,
          message: 'File downloaded successfully',
          filename: filename || defaultFilename
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to export file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Save using File System Access API
   */
  private async saveWithFileSystemAPI(content: string, filename?: string, forceNewFile: boolean = false): Promise<FileOperationResult> {
    if (forceNewFile) {
      this.currentFileHandle = null
    }

    if (!this.currentFileHandle) {
      this.currentFileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename || 'semantic-network.json',
        types: [{
          description: 'JSON files',
          accept: { 'application/json': ['.json'] }
        }]
      })
    }

    const writable = await this.currentFileHandle.createWritable()
    await writable.write(content)
    await writable.close()

    return {
      success: true,
      message: 'File saved successfully',
      filename: this.currentFileHandle.name
    }
  }

  /**
   * Save using download fallback
   */
  private saveWithDownload(content: string, filename: string): FileOperationResult {
    this.downloadFile(content, filename, 'application/json')
    return {
      success: true,
      message: 'File downloaded successfully',
      filename
    }
  }

  /**
   * Load using File System Access API
   */
  private async loadWithFileSystemAPI(): Promise<FileOperationResult> {
    const [fileHandle] = await (window as any).showOpenFilePicker({
      types: [{
        description: 'JSON files',
        accept: { 'application/json': ['.json'] }
      }]
    })

    // Store the file handle for future saves
    this.currentFileHandle = fileHandle

    const file = await fileHandle.getFile()
    const content = await file.text()
    const data = JSON.parse(content) as SemanticNetwork

    this.validateNetworkData(data)

    return {
      success: true,
      message: 'File loaded successfully',
      data,
      filename: file.name
    }
  }

  /**
   * Load using file input fallback
   */
  private loadWithInput(): Promise<FileOperationResult> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      
      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0]
        if (!file) {
          reject(new Error('No file selected'))
          return
        }

        try {
          const content = await file.text()
          const data = JSON.parse(content) as SemanticNetwork
          
          this.validateNetworkData(data)

          resolve({
            success: true,
            message: 'File loaded successfully',
            data,
            filename: file.name
          })
        } catch (error) {
          reject(error)
        }
      }

      input.click()
    })
  }

  /**
   * Validate network data structure
   */
  private validateNetworkData(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid file format: not a valid JSON object')
    }

    if (!data.metadata || !data.graph) {
      throw new Error('Invalid file format: missing required fields (metadata, graph)')
    }

    if (typeof data.graph !== 'object') {
      throw new Error('Invalid file format: graph must be an object')
    }

    // Validate graph structure
    for (const [word, connections] of Object.entries(data.graph)) {
      if (typeof word !== 'string') {
        throw new Error('Invalid file format: graph keys must be strings')
      }
      if (!Array.isArray(connections)) {
        throw new Error('Invalid file format: graph values must be arrays')
      }
    }
  }

  /**
   * Convert network to CSV format
   */
  private convertToCSV(network: SemanticNetwork): string {
    const headers = ['Word', 'Connections', 'Connection Count']
    const rows = [headers.join(',')]

    Object.entries(network.graph).forEach(([word, connections]) => {
      const connectionsStr = connections.join(';')
      rows.push(`"${word}","${connectionsStr}",${connections.length}`)
    })

    return rows.join('\n')
  }

  /**
   * Convert network to text format
   */
  private convertToText(network: SemanticNetwork): string {
    const lines: string[] = []
    
    lines.push('Semantic Word Association Network')
    lines.push('='.repeat(35))
    lines.push('')
    
    lines.push('Metadata:')
    lines.push(`Version: ${network.metadata.version}`)
    lines.push(`Created: ${new Date(network.metadata.created).toLocaleString()}`)
    lines.push(`Last Modified: ${new Date(network.metadata.lastModified).toLocaleString()}`)
    lines.push(`Nodes: ${network.metadata.nodeCount}`)
    lines.push(`Edges: ${network.metadata.edgeCount}`)
    lines.push('')
    
    lines.push('Word Associations:')
    lines.push('-'.repeat(18))
    
    Object.entries(network.graph)
      .sort(([, a], [, b]) => b.length - a.length)
      .forEach(([word, connections]) => {
        lines.push(`${word} (${connections.length} connections):`)
        if (connections.length > 0) {
          lines.push(`  ${connections.join(', ')}`)
        }
        lines.push('')
      })

    return lines.join('\n')
  }

  /**
   * Download file utility
   */
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    URL.revokeObjectURL(url)
  }

  /**
   * Create a new file (clears current file handle)
   */
  newFile(): void {
    this.currentFileHandle = null
  }

  /**
   * Save As (force new file picker)
   */
  async saveAsFile(network: SemanticNetwork, filename?: string): Promise<FileOperationResult> {
    return this.saveFile(network, filename, true)
  }

  /**
   * Check if we have a current file handle
   */
  get hasCurrentFile(): boolean {
    return this.currentFileHandle !== null
  }

  /**
   * Get current filename if available
   */
  get currentFilename(): string | null {
    return this.currentFileHandle?.name || null
  }

  /**
   * Check if File System Access API is supported
   */
  get isFileSystemAccessSupported(): boolean {
    return this.hasFileSystemAccess
  }
} 