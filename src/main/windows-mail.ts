import { spawn } from 'node:child_process'

export function openWindowsEmailDraft(
  recipient: string,
  subject: string,
  body: string,
  pdfPath: string
): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)

  const script = `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public static class PosReceiptMail {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Recipient {
        public int Reserved;
        public int RecipientClass;
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string Address;
        public int EntryIdSize;
        public IntPtr EntryId;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct FileAttachment {
        public int Reserved;
        public int Flags;
        public int Position;
        [MarshalAs(UnmanagedType.LPWStr)] public string Path;
        [MarshalAs(UnmanagedType.LPWStr)] public string FileName;
        public IntPtr FileType;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Message {
        public int Reserved;
        [MarshalAs(UnmanagedType.LPWStr)] public string Subject;
        [MarshalAs(UnmanagedType.LPWStr)] public string NoteText;
        public IntPtr MessageType;
        public IntPtr DateReceived;
        public IntPtr ConversationId;
        public int Flags;
        public IntPtr Originator;
        public int RecipientCount;
        public IntPtr Recipients;
        public int FileCount;
        public IntPtr Files;
    }

    [DllImport("MAPI32.DLL", CharSet = CharSet.Unicode, EntryPoint = "MAPISendMailW")]
    private static extern int SendMail(IntPtr session, IntPtr window, ref Message message, int flags, int reserved);

    public static int Open(string recipient, string subject, string body, string path, string fileName) {
        IntPtr recipientMemory = IntPtr.Zero;
        IntPtr fileMemory = IntPtr.Zero;
        try {
            var to = new Recipient {
                RecipientClass = 1,
                Name = recipient,
                Address = "SMTP:" + recipient
            };
            var attachment = new FileAttachment {
                Position = -1,
                Path = path,
                FileName = fileName
            };
            recipientMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Recipient)));
            fileMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileAttachment)));
            Marshal.StructureToPtr(to, recipientMemory, false);
            Marshal.StructureToPtr(attachment, fileMemory, false);
            var message = new Message {
                Subject = subject,
                NoteText = body,
                RecipientCount = 1,
                Recipients = recipientMemory,
                FileCount = 1,
                Files = fileMemory
            };
            return SendMail(IntPtr.Zero, IntPtr.Zero, ref message, 9, 0);
        } finally {
            if (recipientMemory != IntPtr.Zero) {
                Marshal.DestroyStructure<Recipient>(recipientMemory);
                Marshal.FreeHGlobal(recipientMemory);
            }
            if (fileMemory != IntPtr.Zero) {
                Marshal.DestroyStructure<FileAttachment>(fileMemory);
                Marshal.FreeHGlobal(fileMemory);
            }
        }
    }
}
'@
Add-Type -TypeDefinition $source
$result = [PosReceiptMail]::Open($env:POS_EMAIL, $env:POS_SUBJECT, $env:POS_BODY, $env:POS_PDF_PATH, $env:POS_PDF_NAME)
if ($result -eq 0 -or $result -eq 1) { exit 0 }
exit $result
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript],
      {
        windowsHide: true,
        env: {
          ...process.env,
          POS_EMAIL: recipient,
          POS_SUBJECT: subject,
          POS_BODY: body,
          POS_PDF_PATH: pdfPath,
          POS_PDF_NAME: pdfPath.split(/[\\/]/).at(-1) ?? 'receipt.pdf'
        },
        stdio: 'ignore'
      }
    )
    child.once('error', () => {
      if (settled) return
      settled = true
      resolve(false)
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      resolve(code === 0)
    })
  })
}
