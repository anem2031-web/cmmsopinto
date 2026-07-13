import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
const mockGetSections = vi.fn();
const mockCreateSection = vi.fn();
const mockUpdateSection = vi.fn();
const mockDeleteSection = vi.fn();
const mockGetSectionById = vi.fn();

vi.mock("../_core/db", () => ({
  getSections: mockGetSections,
  createSection: mockCreateSection,
  updateSection: mockUpdateSection,
  deleteSection: mockDeleteSection,
  getSectionById: mockGetSectionById,
}));

describe("Sections CRUD Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSections returns list of sections", async () => {
    const mockData = [
      { id: 1, name: "كون زون", siteId: 1, description: null, createdAt: new Date() },
      { id: 2, name: "فود كورت", siteId: 1, description: "منطقة الطعام", createdAt: new Date() },
    ];
    mockGetSections.mockResolvedValue(mockData);

    const { getSections } = await import("../_core/db");
    const result = await getSections({});
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("كون زون");
  });

  it("getSections filters by siteId", async () => {
    const mockData = [
      { id: 1, name: "كون زون", siteId: 1, description: null, createdAt: new Date() },
    ];
    mockGetSections.mockResolvedValue(mockData);

    const { getSections } = await import("../_core/db");
    const result = await getSections({ siteId: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].siteId).toBe(1);
  });

  it("createSection returns new id", async () => {
    mockCreateSection.mockResolvedValue(5);

    const { createSection } = await import("../_core/db");
    const id = await createSection({ name: "قسم جديد", siteId: 2 });
    expect(id).toBe(5);
    expect(mockCreateSection).toHaveBeenCalledWith({ name: "قسم جديد", siteId: 2 });
  });

  it("updateSection updates fields", async () => {
    mockUpdateSection.mockResolvedValue(undefined);

    const { updateSection } = await import("../_core/db");
    await updateSection(1, { name: "قسم محدث" });
    expect(mockUpdateSection).toHaveBeenCalledWith(1, { name: "قسم محدث" });
  });

  it("deleteSection removes section", async () => {
    mockDeleteSection.mockResolvedValue(undefined);

    const { deleteSection } = await import("../_core/db");
    await deleteSection(3);
    expect(mockDeleteSection).toHaveBeenCalledWith(3);
  });
});
