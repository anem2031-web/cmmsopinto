with open("server/routers.ts", "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find line 1777 (0-indexed: 1776) which is the return statement
# Insert new procedure after line 1778 (the }),)
insert_after = None
for i, line in enumerate(lines):
    if 'return db.getTechnicianPerformance(period === "all"' in line:
        # Next line should be }),
        if i + 1 < len(lines) and '    }),' in lines[i + 1]:
            insert_after = i + 1
            break

if insert_after is None:
    print("ERROR: Could not find insertion point")
else:
    new_lines = [
        "\n",
        "    externalTechnicianPerformance: protectedProcedure.input(z.object({\n",
        '      period: z.enum(["week", "month", "quarter", "year", "all", "custom"]).default("all"),\n',
        "      dateFrom: z.string().optional(),\n",
        "      dateTo: z.string().optional(),\n",
        "    }).optional()).query(async ({ input }) => {\n",
        '      const period = input?.period || "all";\n',
        "      let dateFrom: Date | undefined;\n",
        "      let dateTo: Date | undefined;\n",
        '      if (period === "custom" && input?.dateFrom && input?.dateTo) {\n',
        "        dateFrom = new Date(input.dateFrom);\n",
        "        dateTo = new Date(input.dateTo);\n",
        "        dateTo.setHours(23, 59, 59, 999);\n",
        '      } else if (period !== "all") {\n',
        "        dateTo = new Date();\n",
        "        dateFrom = new Date();\n",
        "        switch (period) {\n",
        "          case \"week\": dateFrom.setDate(dateFrom.getDate() - 7); break;\n",
        "          case \"month\": dateFrom.setMonth(dateFrom.getMonth() - 1); break;\n",
        "          case \"quarter\": dateFrom.setMonth(dateFrom.getMonth() - 3); break;\n",
        "          case \"year\": dateFrom.setFullYear(dateFrom.getFullYear() - 1); break;\n",
        "        }\n",
        "      }\n",
        '      return db.getExternalTechnicianPerformance(period === "all" ? undefined : { dateFrom, dateTo });\n',
        "    }),\n",
    ]
    lines = lines[:insert_after + 1] + new_lines + lines[insert_after + 1:]
    with open("server/routers.ts", "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"Done! Inserted {len(new_lines)} lines after line {insert_after + 1}")
