using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Elevant.Infrastructure.Persistence.Configurations;

internal sealed class MediaAssetConfiguration : IEntityTypeConfiguration<MediaAsset>
{
    public void Configure(EntityTypeBuilder<MediaAsset> builder)
    {
        builder.ToTable("media_assets", "commercial");
        builder.HasKey(asset => asset.Id);
        builder.Property(asset => asset.Id).UseIdentityColumn();
        builder.Property(asset => asset.PublicId).IsRequired();
        builder.HasIndex(asset => asset.PublicId).IsUnique();
        builder.Property(asset => asset.ObjectKey).HasMaxLength(200).IsRequired();
        builder.HasIndex(asset => asset.ObjectKey).IsUnique();
        builder.Property(asset => asset.Purpose).HasMaxLength(32).IsRequired();
        builder.Property(asset => asset.ContentType).HasMaxLength(80).IsRequired();
        builder.Property(asset => asset.Sha256).HasMaxLength(64).IsRequired();
        builder.Property(asset => asset.CreatedAt).HasColumnType("datetimeoffset(3)");
        builder.HasOne<ApplicationUser>().WithMany()
            .HasForeignKey(asset => asset.UploadedByAccountId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
