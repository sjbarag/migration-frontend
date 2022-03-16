import { useEffect, useState, createRef } from "react";
import axios from "axios";
import { saveAs } from 'file-saver';
import { Container, Alert, Col, Row, Dropdown, ButtonGroup, DropdownButton, Button, Spinner } from "react-bootstrap";
import Moment from "react-moment";

import { Statement } from "../components/Statement";
import { StatementsSummary } from "../components/StatementsSummary";
import { FindAndReplaceDialog } from "../components/FindAndReplaceDialog";
import { SQLExecDialog } from "../components/SQLExecDialog";
import { ExportDialog } from "../components/ExportDialog";

import type { Import, ImportStatement } from "../../common/import";
import type { FindAndReplaceArgs } from "../components/FindAndReplaceDialog";

interface ImportPageState {
  data: Import;
  loaded: boolean;
  showExport: boolean;
  showSQLExec: boolean;
  showFindAndReplace: boolean;
  sqlExecText: string;

  activeStatement: number;
  statementRefs: React.RefObject<HTMLTextAreaElement>[];
}

interface ImportPageProps {
  id: string;  
}

export const ImportPage = (props: ImportPageProps) => {
  const [state, setState] = useState<ImportPageState>({
    loaded: false,
    showExport: false,
    showSQLExec: false,
    showFindAndReplace: false,
    sqlExecText: '',
    data: {
      id: props.id,
      unix_nano: 0,
      import_metadata: {
        statements: [],
        status: "",
        message: "",
        database: "",
      },
    },
    activeStatement: -1,
    statementRefs: [],
  });

  const supplyRefs = (data: ImportPageState) => {
    const refs: React.RefObject<HTMLTextAreaElement>[] = [];
    data.data.import_metadata.statements.forEach((statement) => {
      refs.push(createRef());
    })
    data.statementRefs = refs;
    data.activeStatement = -1;
    return data;
  }

  const refresh = () => {
    setState({...state, loaded: false});
    axios.get<Import>("http://" + window.location.hostname + ":5050/get", { params: { 'id': props.id } }).then(
      response => {
        setState(supplyRefs({...state, loaded: true, data: response.data}));
      }
    ).catch(
      error => alert(`Error: ${error}`)
    );
  }

  useEffect(() => {
    refresh();
  }, [props.id])

  const undoAll = () => refresh();

  const handleSubmit = () => {
    setState({...state, loaded: false});
    axios.post<Import>(
      "http://" + window.location.hostname + ":5050/put",
      state.data,
    ).then(
      response => {
        setState(supplyRefs({...state, loaded: true, data: response.data}));
      }
    ).catch(
      error => alert(`Error: ${error}`)
    );
  }

  const handleTextAreaChangeForIdx = (idx: number, event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newState = state.data;
    newState.import_metadata.statements[idx].cockroach = event.target.value;
    setState({...state, data: newState});
  }

  const handleTextAreaChange = (idx: number) => (event: React.ChangeEvent<HTMLTextAreaElement>) => handleTextAreaChangeForIdx(idx, event);

  const handleFixSequence = (statementIdx: number, issueIdentifier: string) => {
    axios.post<ImportStatement>(
      "http://" + window.location.hostname + ":5050/fix_sequence",
      {
        statement: state.data.import_metadata.statements[statementIdx],
        id: issueIdentifier,
      },
    ).then(
      response => {
        const newState = state.data;
        newState.import_metadata.statements[statementIdx] = response.data;
        setState({...supplyRefs({...state, data: newState}), activeStatement: statementIdx});
      }
    ).catch(
      error => alert(`Error: ${error}`)
    );
  }

  const handleIssueDelete = (statementIdx: number, issueIdx: number | null) => {
    const newState = state.data;
    newState.import_metadata.statements[statementIdx].cockroach = '';
    if (issueIdx != null) {
      newState.import_metadata.statements[statementIdx].issues.splice(issueIdx, 1);
    }
    setState({...supplyRefs({...state, data: newState}), activeStatement: statementIdx});
  }

  const deleteAllUnimplemented = () => {  
    alert(`${deleteAllUnimplementedInternal()} statements deleted!`);
  }

  const deleteAllUnimplementedInternal = () => {
    // This is bad but w/e.
    const elems: {
      statementIdx: number;
      issueIdx: number;
    }[] = [];
    state.data.import_metadata.statements.forEach((statement, statementIdx) => {
      if (statement.issues != null) {
        statement.issues.forEach((issue, issueIdx) => {
          if (issue.type === 'unimplemented') {
            elems.push({statementIdx: statementIdx, issueIdx: issueIdx});
          }
        })
      }
    })
    elems.forEach((elem) => handleIssueDelete(elem.statementIdx, elem.issueIdx));
    return elems.length;
  }


  const fixAllSequences = () => {
    alert(`${fixAllSequencesInternal()} sequences affected!`);
  }

  const fixAllSequencesInternal = () => {
    // This is bad but w/e.
    const elems: {
      statementIdx: number;
      id: string;
    }[] = [];

    state.data.import_metadata.statements.forEach((statement, statementIdx) => {
      if (statement.issues != null) {
        statement.issues.forEach((issue) => {
          if (issue.type === 'sequence') {
            elems.push({statementIdx: statementIdx, id: issue.id});
          }
        })
      }
    })
    elems.forEach((elem) => handleFixSequence(elem.statementIdx, elem.id));
    return elems.length;
  }



  const handleAddUser = (user: string) => {
    const newState = state.data;
    newState.import_metadata.statements.splice(0, 0, {
      original: '-- newly added statement',
      cockroach: `CREATE USER IF NOT EXISTS "${user}"`,
      issues: [],
    }, {
      original: '-- newly added statement',
      cockroach: `GRANT admin TO "${user}"`,
      issues: [],
    })
    newState.import_metadata.statements.forEach((statement, statementIdx) => {
      if (statement.issues != null) {
        statement.issues.forEach((issue, issueIdx) => {
          if (issue.type === 'missing_user') {
            // concurrent array deletion bug?
            statement.issues.splice(issueIdx, 1);
          }
        });
      }
    })
    setState({...supplyRefs({...state, data: newState}), activeStatement: state.activeStatement});
  }

  const handleAddAllUsers = () => alert(`${handleAddAllUsersInternal()} users added`);

  const handleAddAllUsersInternal = (): number =>  {
    const users = new Set<string>();
    state.data.import_metadata.statements.forEach((statement) => {
      if (statement.issues != null) {
        statement.issues.forEach((issue) => {
          if (issue.type === 'missing_user') {
            users.add(issue.id);
          }
        });
      }
    });
    users.forEach(user => handleAddUser(user));
    return users.size
  }

  const fixAll = () => {
    var text = '';
    text += `${fixAllSequencesInternal()} sequences converted to UUID\n`;
    text += `${deleteAllUnimplementedInternal()} unimplemented statements deleted\n`;
    text += `${handleAddAllUsersInternal()} users added\n`;
    alert(text);
  }

  const setShowExport = (showExport: boolean) => {
    setState({...state, showExport: showExport});
  }

  const setShowSQLExec = (showSQLExec: boolean, text?: string) => {
    setState({...state, showSQLExec: showSQLExec, sqlExecText: text != null ? text : state.sqlExecText});
  }

  const handleAddStatement = (idx: number) => {
    const newState = state.data;
    newState.import_metadata.statements.splice(idx, 0, {
      original: '-- newly added statement',
      cockroach: '',
      issues: [],
    })
    setState({...supplyRefs({...state, data: newState}), activeStatement: state.activeStatement});
  }

  const handleSave = (exportText: string, fileName: string) => {
    return () => {
      saveAs(new File([exportText], fileName, {type: "text/plain;charset=utf-8"}));
    };
  }

  const setActiveStatement = (idx: number) => {
    setState({...state, activeStatement: idx});
  }

  const handleNextStatementWithIssue = () => {
    for (let i = 0; i < state.data.import_metadata.statements.length; i++) {
      const idx = (state.activeStatement + i + 1) % state.data.import_metadata.statements.length;
      const stmt = state.data.import_metadata.statements[idx];
      if (stmt.issues != null && stmt.issues.length > 0) {
        const ref = state.statementRefs[idx];
        if (ref.current != null) {
          ref.current.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});
          ref.current.focus();
        } else {
          alert("no ref found...");
        }
        return;
      }
    }
    alert('no issues found!');
  }

  const exportText = state.data.import_metadata.statements != null ? state.data.import_metadata.statements.map((statement) => {
    const pg = statement.original.split("\n").map(x => `-- ${x}`).join("\n")
    var crdb = statement.cockroach;
    crdb.trim();
    if (crdb.length > 0 && crdb.charAt(crdb.length - 1) !== ';') {
      crdb += ";";
    }
    return '-- postgres:\n' + pg + '\n' + crdb + '\n';
  }).join('\n') : '';

  const setFindAndReplace = (b: boolean) => setState({...state, showFindAndReplace: b});

  const findAndReplace = (args: FindAndReplaceArgs) => {
    if (args.find !== '') {
      var re : (RegExp | null) = null; 
      try {
        re = new RegExp(args.find); 
      } catch {
        return;
      }
      const newState = state.data;
      state.data.import_metadata.statements.forEach((statement, idx) => {
        if (args.isRegex) {
          if (re == null) {
            alert("invalid regexp");
            return;
          }
          state.data.import_metadata.statements[idx].cockroach =
            state.data.import_metadata.statements[idx].cockroach.replace(re, args.replace);
        } else {
          state.data.import_metadata.statements[idx].cockroach =
            state.data.import_metadata.statements[idx].cockroach.replace(args.find, args.replace);
        }
      });
      setState({...supplyRefs({...state, data: newState}), activeStatement: state.activeStatement});
    }
    setFindAndReplace(false);
  };

  const handleSelectAction = (key: string | null) => {
    if (key == null) {
      return;
    }
    switch (key) {
    case "undoAll":
      undoAll();
      break;
    case "showSQLExec":
      setShowExport(true);
      break;
    case "fixAll":
      fixAll();
      break;
    case "deleteAllUnimplemented":
      deleteAllUnimplemented();
      break;
    case "fixAllSequences":
      fixAllSequences();
      break;
    case "findAndReplace":
      setFindAndReplace(true);
      break;
    case "handleAddAllUsers":
      handleAddAllUsers();
      break;
    default:
      alert("unknown action: " + key)
    }
  }

  return (
    <>
      <Container className="bg-light p-5">
        <h1 className="display-4 fw-bold">
          {!state.loaded ? 'Loading database migration....' : state.data.id}
        </h1>
        {state.loaded ? 
          <>
            <Alert variant={state.data.import_metadata.status}>{state.data.import_metadata.message}</Alert>
            <hr/>
            <StatementsSummary statements={state.data.import_metadata.statements} />
          </>
          : ''
        }          
        <hr/>
        {state.loaded ? <div>Last imported&nbsp;<Moment date={new Date(state.data.unix_nano / 1000000).toISOString()} fromNow /></div>: ''}
      </Container>

      <Container className="p-4 m-2" fluid>
        {state.loaded ? 
          <>
            <ExportDialog show={state.showExport} onHide={() => setShowExport(false)} exportText={exportText} handleSave={handleSave(exportText, state.data.id + '_export.sql')} />
            <FindAndReplaceDialog
              show={state.showFindAndReplace}
              onHide={() => setFindAndReplace(false)}
              findAndReplace={findAndReplace}/>
            <SQLExecDialog show={state.showSQLExec} onHide={() => setShowSQLExec(false)} text={state.sqlExecText} database={state.data.import_metadata.database} />
          </>
          : ''}
        <form className="p-2">
          <Row className="m-2 p-2">
            <Col xs={6}><strong>PostgreSQL statement</strong></Col>
            <Col xs={6}><strong>CockroachDB statement</strong></Col>
          </Row>
          {state.loaded ?
            state.data.import_metadata.statements.map((statement, idx) => (
              <Statement 
                key={'r' + idx} 
                statement={statement} 
                database={state.data.import_metadata.database}
                idx={idx} 
                ref={state.statementRefs[idx]}
                callbacks={{
                  handleIssueDelete: handleIssueDelete,
                  handleTextAreaChange: handleTextAreaChange(idx),
                  handleFixSequence: handleFixSequence,
                  handleAddStatement: handleAddStatement,
                  setShowSQLExec: setShowSQLExec,
                  setActiveStatement: () => setActiveStatement(idx),
                  handleAddUser: handleAddUser,
                }}
              />
            )) : (
              <Row className="justify-content-md-center">
                <Spinner animation="border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </Spinner>
              </Row>
            )
          }
          </form>
      </Container>

      <footer className="fixed-bottom sticky-footer">
        <Container className="m-2" fluid style={{textAlign: 'center'}}>
            {state.loaded ?
              <ButtonGroup>
                <Button variant="primary" onClick={handleSubmit}>Save and Reimport</Button>
                <DropdownButton
                  drop={'up'}
                  as={ButtonGroup}
                  variant="info"
                  title={`Actions`}
                  onSelect={handleSelectAction}
                >
                  <Dropdown.Item eventKey="undoAll">Revert to last import attempt</Dropdown.Item>
                  <Dropdown.Item eventKey="showSQLExec">Show current dump</Dropdown.Item>

                  <Dropdown.Divider />

                  <Dropdown.Header>Editors</Dropdown.Header>
                  <Dropdown.Item eventKey="findAndReplace">Find and Replace</Dropdown.Item>
                  
                  <Dropdown.Divider />

                  <Dropdown.Header>Automagic fixers</Dropdown.Header>
                  <Dropdown.Item eventKey="fixAll">Automatically fix all issues</Dropdown.Item>
                  <Dropdown.Item eventKey="handleAddAllUsers">Add missing users</Dropdown.Item>
                  <Dropdown.Item eventKey="deleteAllUnimplemented">Delete unimplemented statements</Dropdown.Item>
                  <Dropdown.Item eventKey="fixAllSequences">Fix all sequences</Dropdown.Item>
                </DropdownButton>
                <Button variant="secondary" onClick={handleSave(exportText, state.data.id + '_export.sql')}>Export SQL File</Button>
                <Button variant="outline-secondary" onClick={() => setShowSQLExec(true)} disabled={state.data.import_metadata.database === ''}>Query Current State</Button>
                <Button variant="danger" onClick={handleNextStatementWithIssue}>Scroll to Next Issue</Button>
              </ButtonGroup>
            : <span className="visually-hidden">Loading...</span>}
        </Container>
      </footer>
    </>
  );
}