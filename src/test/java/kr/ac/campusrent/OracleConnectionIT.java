package kr.ac.campusrent;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.sql.PreparedStatement;
import java.util.*;
import java.util.regex.*;
import java.nio.charset.StandardCharsets;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;
import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.*;

/** Explicit opt-in: mvn -Poracle-it verify. SELECT only; no DDL/DML or NEXTVAL. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class OracleConnectionIT {
    @Autowired DataSource dataSource;

    @Test
    void deployedColumnsAndSequencesMatchErdSchema() throws Exception {
        String ddl=StreamUtils.copyToString(new ClassPathResource("db/schema-oracle.sql").getInputStream(),StandardCharsets.UTF_8);
        Matcher tables=Pattern.compile("CREATE TABLE ([A-Z_]+) \\(\\s*([\\s\\S]*?)\\n\\);").matcher(ddl);
        int tableCount=0,columnCount=0;
        try(Connection connection=dataSource.getConnection()) {
            Map<String,Map<String,String>> metadata=new HashMap<>();
            try(Statement query=connection.createStatement();ResultSet rows=query.executeQuery("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_PRECISION,CHAR_LENGTH,NULLABLE FROM USER_TAB_COLUMNS")) {
                while(rows.next()) {
                    String type=rows.getString(3),size="";
                    if(type.startsWith("TIMESTAMP"))type="TIMESTAMP";
                    else if(type.equals("NUMBER"))size=rows.getString(4);
                    else if(type.equals("VARCHAR2"))size=rows.getString(5)+" CHAR";
                    else if(type.equals("CHAR"))size=rows.getString(5);
                    metadata.computeIfAbsent(rows.getString(1),name->new LinkedHashMap<>()).put(rows.getString(2),type+"|"+size+"|"+rows.getString(6));
                }
            }
            while(tables.find()) {
                tableCount++;String table=tables.group(1);Map<String,String> expected=new LinkedHashMap<>();
                Matcher columns=Pattern.compile("(?m)^    ([A-Z_]+) (NUMBER|VARCHAR2|CHAR|TIMESTAMP)(?:\\(([^)]+)\\))? (NOT NULL|NULL),?$").matcher(tables.group(2));
                while(columns.find()) expected.put(columns.group(1),columns.group(2)+"|"+(columns.group(3)==null?"":columns.group(3))+"|"+(columns.group(4).equals("NULL")?"Y":"N"));
                // The first line starts immediately after the regex's whitespace match.
                String body="    "+tables.group(2).trim();columns=Pattern.compile("(?m)^    ([A-Z_]+) (NUMBER|VARCHAR2|CHAR|TIMESTAMP)(?:\\(([^)]+)\\))? (NOT NULL|NULL),?$").matcher(body);
                while(columns.find()) expected.put(columns.group(1),columns.group(2)+"|"+(columns.group(3)==null?"":columns.group(3))+"|"+(columns.group(4).equals("NULL")?"Y":"N"));
                Map<String,String> actual=metadata.get(table);
                assertEquals(expected,actual,"ERD columns: "+table);columnCount+=actual.size();
            }
            assertEquals(26,tableCount);assertEquals(185,columnCount);
            Matcher sequences=Pattern.compile("CREATE SEQUENCE (SEQ_[A-Z_]+)").matcher(ddl);int sequenceCount=0;
            Set<String> actualSequences=new HashSet<>();
            try(Statement query=connection.createStatement();ResultSet rows=query.executeQuery("SELECT SEQUENCE_NAME FROM USER_SEQUENCES")){while(rows.next())actualSequences.add(rows.getString(1));}
            while(sequences.find()) {sequenceCount++;assertTrue(actualSequences.contains(sequences.group(1)),sequences.group(1));}
            assertEquals(17,sequenceCount);
            try(Statement query=connection.createStatement();ResultSet rows=query.executeQuery("SELECT COUNT(*) FROM USER_CONSTRAINTS WHERE STATUS<>'ENABLED' OR VALIDATED<>'VALIDATED'")){assertTrue(rows.next());assertEquals(0,rows.getInt(1));}
            System.out.println("ERD audit: 26 tables / 185 matching columns / 17 sequences; all constraints enabled and validated.");
        }
    }

    @Test
    void connectsToOracleAndListsExistingSchemaObjects() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (Statement statement = connection.createStatement()) {
                statement.setQueryTimeout(10);
                statement.execute("SET TRANSACTION READ ONLY");
                try (ResultSet rows = statement.executeQuery("SELECT 1 FROM DUAL")) {
                    assertTrue(rows.next());
                    assertEquals(1, rows.getInt(1));
                }
                DatabaseMetaData metadata = connection.getMetaData();
                assertEquals("Oracle", metadata.getDatabaseProductName());
                System.out.println("DB connection: PASS; SELECT 1 FROM DUAL = 1");
                System.out.println("Database: " + metadata.getDatabaseProductVersion());
                System.out.println("JDBC driver: " + metadata.getDriverVersion());
                printObjects(statement, "TABLE", "SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME", "TBL_");
                printObjects(statement, "SEQUENCE", "SELECT SEQUENCE_NAME FROM USER_SEQUENCES ORDER BY SEQUENCE_NAME", "SEQ_");
            } finally {
                connection.rollback();
            }
        }
    }

    private void printObjects(Statement statement, String type, String query, String prefix) throws Exception {
        int count = 0;
        try (ResultSet rows = statement.executeQuery(query)) {
            while (rows.next()) {
                String name = rows.getString(1);
                System.out.println(type + ": " + name
                        + (name.startsWith(prefix) ? "" : " [confirm before any rename]"));
                count++;
            }
        }
        System.out.println(type + " count: " + count);
    }
}
