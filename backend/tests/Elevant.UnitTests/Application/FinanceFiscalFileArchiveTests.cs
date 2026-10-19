using Elevant.Infrastructure.Finance;
namespace Elevant.UnitTests.Application;
public sealed class FinanceFiscalFileArchiveTests
{
 [Fact] public async Task KeepsOriginalBytesAcrossInstancesAndRejectsConflictingOverwrite()
 {
  var path = Path.Combine(Path.GetTempPath(), "elevant-fiscal-qa-" + Guid.NewGuid().ToString("N"));
  try {
   var first = new FinanceFiscalFileArchive(path);
   byte[] original = [0x01,0xFF,0x20,0x00];
   await first.PutAsync("fiscal/test/document/original.xml", original);
   await first.PutAsync("fiscal/test/document/original.xml", original);
   var restarted = new FinanceFiscalFileArchive(path);
   Assert.Equal(original, await restarted.GetAsync("fiscal/test/document/original.xml"));
   await Assert.ThrowsAsync<IOException>(()=>restarted.PutAsync("fiscal/test/document/original.xml", [0x99]));
   await Assert.ThrowsAsync<ArgumentException>(()=>restarted.GetAsync("../../escape.xml"));
  } finally { if(Directory.Exists(path)) Directory.Delete(path,true); }
 }
}
